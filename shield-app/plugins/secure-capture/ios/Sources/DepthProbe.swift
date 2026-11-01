import AVFoundation
import Foundation

/// One test shot on the LiDAR camera, to learn what iOS gives an app as depth with a photo.
/// It signs nothing, stores nothing and sends nothing: the photo is dropped here and only integers and short strings are returned.
final class DepthProbe: NSObject, AVCapturePhotoCaptureDelegate {
    private static var current: DepthProbe?

    static func run(_ completion: @escaping ([String: Any]) -> Void) {
        DispatchQueue.main.async {
            if current != nil {
                completion(["error": "probe-already-running"])
                return
            }
            let probe = DepthProbe()
            current = probe
            probe.start { result in
                DispatchQueue.main.async {
                    current = nil
                    completion(result)
                }
            }
        }
    }

    private let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "app.tradedeck.shield.depthprobe")
    private let lock = NSLock()
    private var finished = false
    private var completion: (([String: Any]) -> Void)?
    private var report: [String: Any] = [:]

    private func start(_ completion: @escaping ([String: Any]) -> Void) {
        self.completion = completion
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            end(["error": "camera-permission-not-asked"])
            return
        default:
            end(["error": "camera-denied"])
            return
        }
        // The app's own camera session and this one cannot use the camera together.
        CameraEngine.shared.stop()
        queue.async { self.configureAndShoot() }
        queue.asyncAfter(deadline: .now() + 12) { self.end(["error": "timed-out"]) }
    }

    private func configureAndShoot() {
        // The LiDAR device type exists from iOS 15.4; the app still supports 15.0.
        guard #available(iOS 15.4, *), let device = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) else {
            end(["lidar_device": false, "error": "no-lidar-camera"])
            return
        }
        report["lidar_device"] = true
        do {
            let input = try AVCaptureDeviceInput(device: device)
            session.beginConfiguration()
            session.sessionPreset = .photo
            guard session.canAddInput(input), session.canAddOutput(output) else {
                session.commitConfiguration()
                end(["error": "cannot-configure"])
                return
            }
            session.addInput(input)
            session.addOutput(output)
            session.commitConfiguration()
            // Depth delivery can only be asked for once the input and output are in the session.
            report["depth_delivery_supported"] = output.isDepthDataDeliverySupported
            guard output.isDepthDataDeliverySupported else {
                end(["error": "depth-delivery-unsupported"])
                return
            }
            output.isDepthDataDeliveryEnabled = true
            session.startRunning()
            // A moment for exposure and the depth stream to settle.
            queue.asyncAfter(deadline: .now() + 0.8) {
                let settings = AVCapturePhotoSettings()
                settings.flashMode = .off
                settings.isDepthDataDeliveryEnabled = true
                self.output.capturePhoto(with: settings, delegate: self)
            }
        } catch {
            end(["error": "capture-failed: \(error.localizedDescription)"])
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error {
            end(["error": "capture-failed: \(error.localizedDescription)"])
            return
        }
        report["captured"] = true
        guard let depth = photo.depthData else {
            end(["error": "no-depth-with-photo"])
            return
        }
        let metres = depth.depthDataType == kCVPixelFormatType_DepthFloat32 ? depth : depth.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let map = metres.depthDataMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        let width = CVPixelBufferGetWidth(map)
        let height = CVPixelBufferGetHeight(map)
        let rowBytes = CVPixelBufferGetBytesPerRow(map)
        guard let base = CVPixelBufferGetBaseAddress(map), width > 0, height > 0 else {
            end(["error": "no-depth-with-photo"])
            return
        }
        var millimetres: [Int] = []
        millimetres.reserveCapacity(width * height)
        for y in 0..<height {
            let row = (base + y * rowBytes).assumingMemoryBound(to: Float32.self)
            for x in 0..<width {
                let metresAway = row[x]
                if metresAway.isFinite && metresAway > 0 { millimetres.append(Int((metresAway * 1000).rounded())) }
            }
        }
        millimetres.sort()
        report["width"] = width
        report["height"] = height
        if let low = millimetres.first, let high = millimetres.last {
            report["min_mm"] = low
            report["max_mm"] = high
            report["median_mm"] = millimetres[millimetres.count / 2]
        }
        report["valid_percent"] = Int((Double(millimetres.count) / Double(width * height) * 100).rounded())
        report["accuracy"] = depth.depthDataAccuracy == .absolute ? "absolute" : "relative"
        report["quality"] = depth.depthDataQuality == .high ? "high" : "low"
        report["filtered"] = depth.isDepthDataFiltered
        end([:])
    }

    /// Ends the check once. `extra` is merged over what was measured so far.
    private func end(_ extra: [String: Any]) {
        lock.lock()
        if finished {
            lock.unlock()
            return
        }
        finished = true
        let done = completion
        completion = nil
        lock.unlock()
        if session.isRunning { session.stopRunning() }
        let result = report.merging(extra) { _, new in new }
        done?(result)
    }
}
