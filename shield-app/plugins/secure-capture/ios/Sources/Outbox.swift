import Foundation

/// App-private outbox. Originals and records are written atomically and there is no delete.
/// Files live in Application Support, are excluded from backup, and use
/// complete-until-first-user-authentication protection.
enum Outbox {
    private static let rootName = "shield-outbox"

    static func hasRecords() -> Bool {
        let folder = recordsDir()
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        return names.contains { $0.hasSuffix(".json") }
    }

    static func chain(ticketId: String) -> [String: Any]? {
        readJSON(file: chainsDir().appendingPathComponent(safe(ticketId) + ".json"))
    }

    static func writeChain(ticketId: String, chain: [String: Any]) throws {
        try atomic(chainsDir().appendingPathComponent(safe(ticketId) + ".json"), jsonData(chain))
    }

    static func writeRecord(recordHash: String, json: [String: Any], photo: Data) throws {
        try atomic(photosDir().appendingPathComponent(recordHash + ".jpg"), photo)
        try atomic(recordsDir().appendingPathComponent(recordHash + ".json"), jsonData(json))
    }

    static func readRecord(recordHash: String) -> [String: Any]? {
        readJSON(file: recordsDir().appendingPathComponent(recordHash + ".json"))
    }

    static func readPhoto(recordHash: String) -> Data? {
        let file = photosDir().appendingPathComponent(recordHash + ".jpg")
        return try? Data(contentsOf: file)
    }

    /// Real ticket ids stored inside the chain files. Filenames are hashes.
    static func ticketIds() -> [String] {
        let folder = chainsDir()
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        return names.compactMap { name in
            guard name.hasSuffix(".json") else { return nil }
            let json = readJSON(file: folder.appendingPathComponent(name))
            guard let id = json?["ticket_id"] as? String, !id.isEmpty else { return nil }
            return id
        }
    }

    static func jsonReady(_ value: Any) -> Any {
        switch value {
        case let number as Int64: return NSNumber(value: number)
        case let number as Int: return NSNumber(value: number)
        case let flag as Bool: return flag
        case let text as String: return text
        case let object as [String: Any]:
            var out: [String: Any] = [:]
            for (key, child) in object { out[key] = jsonReady(child) }
            return out
        case let list as [Any]:
            return list.map { jsonReady($0) }
        case let list as [String]:
            return list
        case let list as [Int64]:
            return list.map { NSNumber(value: $0) }
        case let list as [Int]:
            return list.map { NSNumber(value: $0) }
        case is NSNull: return NSNull()
        default:
            if let list = value as? NSArray { return list.map { jsonReady($0) } }
            return String(describing: value)
        }
    }

    static func fromJSON(_ value: Any) -> Any {
        if value is NSNull { return NSNull() }
        if let text = value as? String { return text }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
            let asDouble = number.doubleValue
            if asDouble.rounded() != asDouble { return asDouble }
            return number.int64Value
        }
        if let object = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (key, child) in object { out[key] = fromJSON(child) }
            return out
        }
        if let list = value as? [Any] { return list.map { fromJSON($0) } }
        return value
    }

    private static func jsonData(_ value: [String: Any]) throws -> Data {
        let ready = jsonReady(value)
        guard JSONSerialization.isValidJSONObject(ready) else {
            throw CaptureRecord.ContractError("record could not be stored")
        }
        return try JSONSerialization.data(withJSONObject: ready)
    }

    private static func readJSON(file: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: file),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return fromJSON(raw) as? [String: Any]
    }

    private static func atomic(_ dest: URL, _ bytes: Data) throws {
        let folder = dest.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let tmp = folder.appendingPathComponent(dest.lastPathComponent + ".tmp")
        try bytes.write(to: tmp, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        if FileManager.default.fileExists(atPath: dest.path) {
            _ = try FileManager.default.replaceItemAt(dest, withItemAt: tmp)
        } else {
            try FileManager.default.moveItem(at: tmp, to: dest)
        }
        try excludeFromBackup(root())
    }

    private static func safe(_ ticketId: String) -> String {
        CaptureRecord.sha256Hex(Data(ticketId.utf8))
    }

    private static func root() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent(rootName, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? excludeFromBackup(dir)
        return dir
    }

    private static func chainsDir() -> URL { child("chains") }
    private static func recordsDir() -> URL { child("records") }
    private static func photosDir() -> URL { child("photos") }

    private static func child(_ name: String) -> URL {
        let dir = root().appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func excludeFromBackup(_ url: URL) throws {
        var copy = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try copy.setResourceValues(values)
    }
}
