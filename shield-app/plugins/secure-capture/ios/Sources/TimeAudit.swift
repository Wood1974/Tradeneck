import Foundation

/// Time labels from Tradedeck-api `time_audit.py`. Flags never enter the decision.
/// 120000 ms agrees. 120001 ms is DEVICE CLOCK MISMATCH. A reboot is UNVERIFIED TIME.
enum TimeAudit {
    static let clockMismatchLimitMs: Int64 = 120_000
    static let consistent = "CONSISTENT"
    static let unverified = "UNVERIFIED TIME"
    static let mismatch = "DEVICE CLOCK MISMATCH"

    static func assess(_ ticket: [String: Any], _ capture: [String: Any]) throws -> [String: Any] {
        let changed = try bootChanged(ticket, capture)
        let ticketWall = try optionalLong(ticket, "wall_time_ms")
        let captureWall = try optionalLong(capture, "wall_time_ms")
        let ticketMono = try optionalLong(ticket, "monotonic_ms", nonNegative: true)
        let captureMono = try optionalLong(capture, "monotonic_ms", nonNegative: true)
        let gnss = try gnssCheck(capture, captureWall)

        var monotonicDelta: Int64?
        var unverifiedNote: String?
        var mismatchNote: String?

        if changed {
            unverifiedNote = "The boot identity changed between the ticket and the photo, so the monotonic interval cannot be checked."
        } else if ticketWall == nil || captureWall == nil || ticketMono == nil || captureMono == nil {
            unverifiedNote = "A wall-clock or monotonic reading is missing, so the monotonic interval cannot be checked."
        } else if let ticketWall, let captureWall, let ticketMono, let captureMono {
            let elapsed = captureMono - ticketMono
            if elapsed < 0 {
                unverifiedNote = "The monotonic clock moved backward between the ticket and the photo, so the monotonic interval cannot be checked."
            } else {
                monotonicDelta = abs(captureWall - (ticketWall + elapsed))
                if let monotonicDelta, monotonicDelta > clockMismatchLimitMs {
                    mismatchNote = "The wall clock differs from the ticket time plus monotonic elapsed by \(monotonicDelta) ms, which is more than \(clockMismatchLimitMs) ms."
                }
            }
        }

        var gnssNote: String?
        if gnss.status == "mismatch" {
            let gnssReason = "GNSS time differs from the wall clock by \(gnss.delta ?? 0) ms, which is more than \(clockMismatchLimitMs) ms."
            mismatchNote = mismatchNote == nil ? gnssReason : "\(mismatchNote!) \(gnssReason)"
        } else if gnss.status == "absent" {
            gnssNote = unverifiedNote == nil
                ? "No GNSS time was present; the time verdict stands on the monotonic clock."
                : "No GNSS time was present."
        } else if gnss.status == "uncompared" {
            gnssNote = "GNSS time was present, but the wall clock was not, so it was not compared."
        } else {
            gnssNote = "GNSS time is within \(clockMismatchLimitMs) ms of the wall clock."
        }

        var labels: [String] = []
        if unverifiedNote != nil { labels.append(unverified) }
        if mismatchNote != nil { labels.append(mismatch) }
        let verdict = labels.contains(mismatch) ? mismatch : (labels.contains(unverified) ? unverified : consistent)
        var parts: [String] = []
        if let unverifiedNote { parts.append(unverifiedNote) }
        if let mismatchNote { parts.append(mismatchNote) }
        if verdict == consistent {
            parts.append("The boot did not change, and the wall clock is within \(clockMismatchLimitMs) ms of the ticket time plus monotonic elapsed.")
        }
        if let gnssNote { parts.append(gnssNote) }
        var result: [String: Any] = [
            "verdict": verdict,
            "labels": labels,
            "boot_changed": changed,
            "gnss": gnss.status,
            "detail": parts.joined(separator: " "),
        ]
        if let monotonicDelta { result["monotonic_delta_ms"] = monotonicDelta }
        else { result["monotonic_delta_ms"] = NSNull() }
        if let delta = gnss.delta { result["gnss_delta_ms"] = delta }
        else { result["gnss_delta_ms"] = NSNull() }
        return result
    }

    static func bootChanged(_ ticket: [String: Any], _ capture: [String: Any]) throws -> Bool {
        let ticketId = try optionalText(ticket, "boot_id")
        let captureId = try optionalText(capture, "boot_id")
        let ticketCount = try optionalLong(ticket, "boot_count", nonNegative: true)
        let captureCount = try optionalLong(capture, "boot_count", nonNegative: true)
        var saw = false
        if ticketId != nil || captureId != nil {
            saw = true
            if ticketId == nil || captureId == nil || ticketId != captureId { return true }
        }
        if ticketCount != nil || captureCount != nil {
            saw = true
            if ticketCount == nil || captureCount == nil || ticketCount != captureCount { return true }
        }
        return !saw
    }

    private static func gnssCheck(_ capture: [String: Any], _ wall: Int64?) throws -> (status: String, delta: Int64?) {
        guard let time = try optionalLong(capture, "gnss_time_ms") else { return ("absent", nil) }
        guard let wall else { return ("uncompared", nil) }
        let delta = abs(time - wall)
        return (delta > clockMismatchLimitMs ? "mismatch" : "agrees", delta)
    }

    private static func optionalLong(_ obs: [String: Any], _ key: String, nonNegative: Bool = false) throws -> Int64? {
        guard obs.keys.contains(key), !CaptureRecord.isNull(obs[key]) else { return nil }
        if CaptureRecord.isNull(obs[key]) { return nil }
        let value = obs[key]
        if value is Double || value is Float {
            throw CaptureRecord.ContractError("\(key) is a float; times and counts in this check are whole milliseconds")
        }
        if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
            let asDouble = number.doubleValue
            if asDouble.rounded() != asDouble {
                throw CaptureRecord.ContractError("\(key) is a float; times and counts in this check are whole milliseconds")
            }
        }
        if value is Bool { throw CaptureRecord.ContractError("\(key) must be a whole number") }
        guard let number = CaptureRecord.asLong(value) else {
            throw CaptureRecord.ContractError("\(key) must be a whole number")
        }
        if abs(number) > CaptureRecord.jsSafeInt {
            throw CaptureRecord.ContractError("\(key) is outside the range a JSON number can carry exactly")
        }
        if nonNegative && number < 0 { throw CaptureRecord.ContractError("\(key) cannot be negative") }
        return number
    }

    private static func optionalText(_ obs: [String: Any], _ key: String) throws -> String? {
        guard obs.keys.contains(key), !CaptureRecord.isNull(obs[key]) else { return nil }
        guard let text = obs[key] as? String, !text.isEmpty else {
            throw CaptureRecord.ContractError("\(key) must be a non-empty string when it is present")
        }
        return text
    }
}
