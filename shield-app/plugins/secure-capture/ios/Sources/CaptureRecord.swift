import CryptoKit
import Foundation

/// Byte rules for one capture record. Matches Tradedeck-api `capture_record.py`:
/// whole numbers only, sorted keys, tight separators, non-ASCII as `\uXXXX`,
/// null omitted, and `record_hash = SHA256(canonical || "|" || prev_hash)`.
enum CaptureRecord {
    static let version = 1
    static let jsSafeInt: Int64 = 9_007_199_254_740_991
    static let genesisChallenge = "shield-genesis-v1"
    private static let maxText = 512
    static let recordFields = [
        "version", "checkpoint_id", "photo_sha256", "ticket_id", "wall_time_ms",
        "monotonic_ms", "boot_id", "boot_count", "gnss_time_ms", "location_simulated",
        "sensor_hash", "depth_hash", "depth_present", "flags",
    ]
    private static let required: Set<String> = [
        "version", "checkpoint_id", "photo_sha256", "ticket_id", "wall_time_ms", "monotonic_ms", "flags",
    ]
    private static let intFields: Set<String> = [
        "version", "wall_time_ms", "monotonic_ms", "boot_count", "gnss_time_ms", "flags",
    ]
    private static let nonNegative: Set<String> = ["version", "monotonic_ms", "boot_count", "flags"]
    private static let boolFields: Set<String> = ["location_simulated", "depth_present"]
    private static let hexFields: Set<String> = ["photo_sha256", "sensor_hash", "depth_hash"]
    private static let textFields: Set<String> = ["checkpoint_id", "ticket_id", "boot_id"]

    struct ContractError: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func isSha256Hex(_ value: String) -> Bool {
        guard value.count == 64 else { return false }
        return value.allSatisfy { $0.isHexDigit && ($0.isNumber || $0.isLowercase) }
    }

    static func canonical(_ record: [String: Any]) throws -> String {
        try checkShape(record)
        var out: [String: Any] = [:]
        for key in recordFields {
            guard record.keys.contains(key), !isNull(record[key]) else { continue }
            out[key] = try field(key, record[key])
        }
        return try canonicalJson(out)
    }

    static func canonicalWhole(_ payload: [String: Any]) throws -> String {
        let walked = try dropNulls(try walkWhole(payload, "payload"))
        guard let object = walked as? [String: Any] else {
            throw ContractError("snapshot must be a JSON object")
        }
        return try canonicalJson(object)
    }

    static func signingMessage(_ record: [String: Any], prevHash: String) throws -> Data {
        var message = Data((try canonical(record)).utf8)
        message.append(0x7c)
        message.append(Data(prevHash.utf8))
        return message
    }

    static func link(_ record: [String: Any], prevHash: String) throws -> String {
        sha256Hex(try signingMessage(record, prevHash: prevHash))
    }

    static func seal(_ record: [String: Any], prevHash: String) throws -> [String: Any] {
        guard isSha256Hex(prevHash) else {
            throw ContractError("prev_hash must be a 64-character lowercase hex SHA-256")
        }
        let digest = try link(record, prevHash: prevHash)
        var sealed = record
        for key in Array(sealed.keys) where recordFields.contains(key) && isNull(sealed[key]) {
            sealed.removeValue(forKey: key)
        }
        sealed["prev_hash"] = prevHash
        sealed["record_hash"] = digest
        return sealed
    }

    static func verifyChain(_ records: [[String: Any]], firstPrev: String, expectHead: String? = nil) -> [String: Any] {
        var expectedPrev = firstPrev
        var brokenAt: Int?
        var reason: String?
        for (index, record) in records.enumerated() {
            let storedHash = record["record_hash"] as? String
            let storedPrev = record["prev_hash"] as? String
            if storedHash == nil || storedHash?.isEmpty == true {
                brokenAt = index
                reason = "record carries no hash (never linked, or the hash was stripped)"
                break
            }
            if storedPrev != expectedPrev {
                brokenAt = index
                reason = "link broken: this record does not name the hash of the record before it"
                break
            }
            do {
                let recomputed = try link(record, prevHash: storedPrev ?? "")
                if recomputed != storedHash {
                    brokenAt = index
                    reason = "bytes do not reproduce the hash: a signed field was edited after the record was hashed"
                    break
                }
            } catch {
                brokenAt = index
                reason = "bytes do not reproduce the hash (\(error))"
                break
            }
            expectedPrev = storedHash ?? expectedPrev
        }
        var intact = brokenAt == nil
        if intact, let expectHead, expectedPrev != expectHead {
            intact = false
            reason = "head does not match the head the holder was given; the chain was extended, shortened, or rewritten"
        }
        var result: [String: Any] = [
            "verdict": intact ? "INTACT" : "TAMPERED",
            "intact": intact,
            "reason": reason as Any? ?? NSNull(),
            "head_hash": expectedPrev,
            "verified": brokenAt ?? records.count,
        ]
        if let brokenAt {
            result["broken_at_index"] = brokenAt
        } else {
            result["broken_at_index"] = NSNull()
        }
        return result
    }

    static func ticketClockBytes(_ observation: [String: Any]) throws -> String {
        var clock: [String: Any] = [:]
        if !isNull(observation["boot_count"]) {
            clock["boot_count"] = try whole(observation["boot_count"], "boot_count", nonNegative: true)
        }
        if let bootId = observation["boot_id"] {
            if isNull(bootId) {
                // absent
            } else if let text = bootId as? String, !text.isEmpty {
                clock["boot_id"] = text
            } else {
                throw ContractError("boot_id must be a non-empty string when it is present")
            }
        }
        if isNull(observation["wall_time_ms"]) || isNull(observation["monotonic_ms"]) {
            throw ContractError("ticket_clock needs wall_time_ms and monotonic_ms")
        }
        clock["monotonic_ms"] = try whole(observation["monotonic_ms"], "monotonic_ms", nonNegative: true)
        clock["wall_time_ms"] = try whole(observation["wall_time_ms"], "wall_time_ms", nonNegative: false)
        if isNull(clock["boot_id"]) && isNull(clock["boot_count"]) {
            throw ContractError("ticket_clock needs a boot_id or a boot_count")
        }
        _ = try TimeAudit.assess(clock, clock)
        return try canonicalJson(clock)
    }

    /// SHA256(ticket_hash_raw || canonical(ticket_clock)). The 32-byte payload inside genesis clientData.
    static func genesisPayload(ticketHashHex: String, observation: [String: Any]) throws -> Data {
        guard isSha256Hex(ticketHashHex) else {
            throw ContractError("ticket hash must be a 64-character lowercase hex SHA-256")
        }
        let clock = Data((try ticketClockBytes(observation)).utf8)
        var raw = Data()
        raw.reserveCapacity(32 + clock.count)
        var index = ticketHashHex.startIndex
        for _ in 0..<32 {
            let next = ticketHashHex.index(index, offsetBy: 2)
            guard let byte = UInt8(ticketHashHex[index..<next], radix: 16) else {
                throw ContractError("ticket hash must be a 64-character lowercase hex SHA-256")
            }
            raw.append(byte)
            index = next
        }
        raw.append(clock)
        return Data(SHA256.hash(data: raw))
    }

    static func genesisClientData(ticketHashHex: String, observation: [String: Any]) throws -> Data {
        var out = Data(genesisChallenge.utf8)
        out.append(try genesisPayload(ticketHashHex: ticketHashHex, observation: observation))
        return out
    }

    static func localGenesisHash(ticketId: String, observation: [String: Any]) throws -> String {
        let clock = try ticketClockBytes(observation)
        let text = "tradedeck.shield.local-genesis.v1\n\(clock)\n\(ticketId)"
        return sha256Hex(Data(text.utf8))
    }

    static func canonicalJson(_ value: Any?) throws -> String {
        if isNull(value) { return "null" }
        if let flag = value as? Bool { return flag ? "true" : "false" }
        if let number = asLong(value) {
            if abs(number) > jsSafeInt { throw ContractError("canonical JSON rejected an unsafe integer") }
            return String(number)
        }
        if let text = value as? String { return escape(text) }
        if let list = value as? [Any] {
            return try "[" + list.map { try canonicalJson($0) }.joined(separator: ",") + "]"
        }
        if let object = value as? [String: Any] {
            let keys = object.keys.sorted()
            return try "{" + keys.map { key in try escape(key) + ":" + canonicalJson(object[key]) }.joined(separator: ",") + "}"
        }
        throw ContractError("canonical JSON cannot render \(typeName(value))")
    }

    static func escape(_ value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            let cp = scalar.value
            switch cp {
            case 0x22: out += "\\\""
            case 0x5c: out += "\\\\"
            case 0x08: out += "\\b"
            case 0x0c: out += "\\f"
            case 0x0a: out += "\\n"
            case 0x0d: out += "\\r"
            case 0x09: out += "\\t"
            case 0x20...0x7e: out.unicodeScalars.append(scalar)
            default:
                if cp > 0xffff {
                    let v = cp - 0x10000
                    let hi = 0xD800 + (v >> 10)
                    let lo = 0xDC00 + (v & 0x3FF)
                    out += String(format: "\\u%04x\\u%04x", hi, lo)
                } else {
                    out += String(format: "\\u%04x", cp)
                }
            }
        }
        out += "\""
        return out
    }

    #if DEBUG
    /// Same bytes as `test-vectors/capture-record-v1.json`. Runs when a debug build loads the plugin.
    static func assertFixtures() {
        do {
            let photo = Data("shield-capture-record-fixture-photo".utf8)
            let photoHash = sha256Hex(photo)
            precondition(photoHash == "cfe8a5966f9ced4e33a1cf652c0aef5c9fec6e629d3d7cacec5b9cc794316aa3", photoHash)
            let prev = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"
            let required: [String: Any] = [
                "version": 1,
                "checkpoint_id": "cp-1",
                "photo_sha256": photoHash,
                "ticket_id": "ticket-1",
                "wall_time_ms": Int64(1_700_000_000_000),
                "monotonic_ms": Int64(5000),
                "boot_count": Int64(4),
                "flags": Int64(0),
            ]
            let canonicalRequired = try canonical(required)
            precondition(canonicalRequired == "{\"boot_count\":4,\"checkpoint_id\":\"cp-1\",\"flags\":0,\"monotonic_ms\":5000,\"photo_sha256\":\"cfe8a5966f9ced4e33a1cf652c0aef5c9fec6e629d3d7cacec5b9cc794316aa3\",\"ticket_id\":\"ticket-1\",\"version\":1,\"wall_time_ms\":1700000000000}")
            let linked = try link(required, prevHash: prev)
            precondition(linked == "fa7368ce2cbc99526824c2e757df21ca2ab234c13df4b3c4c1e18f103b5618aa", linked)
            let snapshot: [String: Any] = [
                "heading_hundredths": Int64(18450),
                "duration_ms": Int64(200),
                "accel_milli_g": [Int64(0), Int64(0), Int64(1000)],
            ]
            let snapshotBytes = try canonicalWhole(snapshot)
            precondition(snapshotBytes == "{\"accel_milli_g\":[0,0,1000],\"duration_ms\":200,\"heading_hundredths\":18450}")
            let sensor = sha256Hex(Data(snapshotBytes.utf8))
            precondition(sensor == "e332899a9037fbffc4792ef03a765477336af15155e708872add90efac49443c")
            let depth: [String: Any] = [
                "width": Int64(4), "height": Int64(4),
                "millimetres": [Int64(1000), Int64(1001), Int64(1002), Int64(1003)],
            ]
            let depthBytes = try canonicalWhole(depth)
            precondition(depthBytes == "{\"height\":4,\"millimetres\":[1000,1001,1002,1003],\"width\":4}")
            let depthHash = sha256Hex(Data(depthBytes.utf8))
            precondition(depthHash == "684da0b2d29666189e6d969244e96218928f8f838956b7036e784667edfd83a5")
            var full = required
            full["checkpoint_id"] = "café"
            full["boot_id"] = "BOOT-SESSION"
            full["gnss_time_ms"] = Int64(1_700_000_000_500)
            full["location_simulated"] = false
            full["sensor_hash"] = sensor
            full["depth_hash"] = depthHash
            full["depth_present"] = true
            full["flags"] = Int64(15)
            let fullBytes = try canonical(full)
            precondition(fullBytes.contains("\\u00e9"), fullBytes)
            precondition(fullBytes == "{\"boot_count\":4,\"boot_id\":\"BOOT-SESSION\",\"checkpoint_id\":\"caf\\u00e9\",\"depth_hash\":\"684da0b2d29666189e6d969244e96218928f8f838956b7036e784667edfd83a5\",\"depth_present\":true,\"flags\":15,\"gnss_time_ms\":1700000000500,\"location_simulated\":false,\"monotonic_ms\":5000,\"photo_sha256\":\"cfe8a5966f9ced4e33a1cf652c0aef5c9fec6e629d3d7cacec5b9cc794316aa3\",\"sensor_hash\":\"e332899a9037fbffc4792ef03a765477336af15155e708872add90efac49443c\",\"ticket_id\":\"ticket-1\",\"version\":1,\"wall_time_ms\":1700000000000}")
            let clock: [String: Any] = [
                "wall_time_ms": Int64(1_700_000_000_000),
                "monotonic_ms": Int64(5000),
                "boot_count": Int64(4),
            ]
            let clockBytes = try ticketClockBytes(clock)
            precondition(clockBytes == "{\"boot_count\":4,\"monotonic_ms\":5000,\"wall_time_ms\":1700000000000}", clockBytes)
            let payload = try genesisPayload(ticketHashHex: String(repeating: "ab", count: 32), observation: clock)
            let payloadHex = payload.map { String(format: "%02x", $0) }.joined()
            precondition(payloadHex == "8352b8a3bafdef0011682fb41bfa20f7f3bb83fac0b1c01169103c96a055423b", payloadHex)
        } catch {
            preconditionFailure("capture-record fixture failed: \(error)")
        }
    }
    #endif

    private static func checkShape(_ record: [String: Any]) throws {
        guard (try? whole(record["version"], "version", nonNegative: true)) == Int64(version) else {
            throw ContractError("unsupported capture record version \(record["version"] ?? "missing"); this contract is version \(version)")
        }
        for key in required where isNull(record[key]) {
            throw ContractError("capture record is missing \(key)")
        }
        let present = record["depth_present"] as? Bool
        let digest = record["depth_hash"]
        if present == true && isNull(digest) {
            throw ContractError("depth_present is true but depth_hash is missing")
        }
        if !isNull(digest) && present != true {
            throw ContractError("depth_hash is set but depth_present is not true")
        }
    }

    private static func field(_ key: String, _ value: Any?) throws -> Any {
        if boolFields.contains(key) {
            guard let flag = value as? Bool else {
                throw ContractError("\(key) must be a JSON boolean, not \(typeName(value))")
            }
            return flag
        }
        if hexFields.contains(key) { return try shaHex(value, key) }
        if intFields.contains(key) { return try whole(value, key, nonNegative: nonNegative.contains(key)) }
        if textFields.contains(key) { return try text(value, key) }
        throw ContractError("unknown capture-record field \(key)")
    }

    static func whole(_ value: Any?, _ key: String, nonNegative: Bool) throws -> Int64 {
        if isFloat(value) {
            throw ContractError("\(key) is a float; the capture record only signs whole numbers (microdegrees, hundredths of a degree, milliseconds, counts)")
        }
        if value is Bool { throw ContractError("\(key) must be a whole number") }
        guard let number = asLong(value) else { throw ContractError("\(key) must be a whole number") }
        if abs(number) > jsSafeInt {
            throw ContractError("\(key) is outside the range a JSON number can carry exactly")
        }
        if nonNegative && number < 0 { throw ContractError("\(key) cannot be negative") }
        return number
    }

    static func asLong(_ value: Any?) -> Int64? {
        switch value {
        case let number as Int64: return number
        case let number as Int: return Int64(number)
        case let number as Int32: return Int64(number)
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return nil }
            return number.int64Value
        default: return nil
        }
    }

    static func isNull(_ value: Any?) -> Bool {
        value == nil || value is NSNull
    }

    private static func isFloat(_ value: Any?) -> Bool {
        if value is Double || value is Float { return true }
        if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
            let asDouble = number.doubleValue
            return asDouble.rounded() != asDouble
        }
        return false
    }

    private static func text(_ value: Any?, _ key: String) throws -> String {
        guard let text = value as? String else { throw ContractError("\(key) must be a string") }
        if text.isEmpty { throw ContractError("\(key) must not be empty") }
        if text.count > maxText { throw ContractError("\(key) is longer than \(maxText) characters") }
        return text
    }

    private static func shaHex(_ value: Any?, _ key: String) throws -> String {
        let text = try text(value, key)
        if !isSha256Hex(text) { throw ContractError("\(key) must be a 64-character lowercase hex SHA-256") }
        return text
    }

    private static func walkWhole(_ value: Any?, _ key: String) throws -> Any? {
        if isFloat(value) {
            throw ContractError("\(key) is a float; the capture record only signs whole numbers (microdegrees, hundredths of a degree, milliseconds, counts)")
        }
        if isNull(value) { return nil }
        if let text = value as? String {
            if text.count > maxText { throw ContractError("\(key) is longer than \(maxText) characters") }
            return text
        }
        if let flag = value as? Bool { return flag }
        if asLong(value) != nil { return try whole(value, key, nonNegative: false) }
        if let list = value as? [Any] { return try list.map { try walkWhole($0, key) } }
        if let object = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (childKey, child) in object {
                if let walked = try walkWhole(child, childKey) {
                    out[childKey] = walked
                } else {
                    out[childKey] = NSNull()
                }
            }
            return out
        }
        throw ContractError("\(key) has type \(typeName(value)), which the capture record cannot sign")
    }

    private static func dropNulls(_ value: Any?) -> Any? {
        if let object = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (key, child) in object where !isNull(child) {
                out[key] = dropNulls(child) ?? NSNull()
            }
            return out
        }
        if let list = value as? [Any] { return list.map { dropNulls($0) ?? NSNull() } }
        return value
    }

    private static func typeName(_ value: Any?) -> String {
        guard let value else { return "null" }
        return String(describing: type(of: value))
    }
}
