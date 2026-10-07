import AVFoundation
import CoreLocation
import UIKit

enum CaptureFailure: Error {
    case denied
    case failed
    case cancelled
    case empty

    var code: String {
        switch self {
        case .denied: return "camera-denied"
        case .failed: return "camera-failed"
        case .cancelled: return "camera-cancelled"
        case .empty: return "empty-bytes"
        }
    }
}

struct Shot {
    let jpeg: Data
    let location: CLLocation?
    let simulated: Bool?
    let mockApi: String?
    let screenCaptured: Bool
}

/// In-app AVFoundation camera. There is no PHPicker, no photo library, and no UIImage re-encode.
/// `fileDataRepresentation()` is the JPEG that gets hashed.
final class CameraEngine: NSObject, AVCapturePhotoCaptureDelegate {
    static let shared = CameraEngine()

    private let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "app.tradedeck.shield.camera")
    private var position: AVCaptureDevice.Position = .back
    private var configured = false
    private var pending: ((Result<Data, Error>) -> Void)?

    func warm(_ position: AVCaptureDevice.Position) {
        queue.async {
            self.apply(position)
            if !self.session.isRunning { self.session.startRunning() }
        }
    }

    func makePreviewLayer() -> AVCaptureVideoPreviewLayer {
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        return layer
    }

    func take(_ completion: @escaping (Result<Data, Error>) -> Void) {
        queue.async {
            self.apply(self.position)
            guard self.configured else {
                completion(.failure(CaptureFailure.failed))
                return
            }
            if !self.session.isRunning { self.session.startRunning() }
            self.pending = completion
            let settings = AVCapturePhotoSettings()
            settings.flashMode = .off
            self.output.capturePhoto(with: settings, delegate: self)
        }
    }

    func stop() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let callback = pending
        pending = nil
        if error != nil {
            callback?(.failure(CaptureFailure.failed))
            return
        }
        guard let data = photo.fileDataRepresentation(), !data.isEmpty else {
            callback?(.failure(CaptureFailure.empty))
            return
        }
        callback?(.success(data))
    }

    private func apply(_ position: AVCaptureDevice.Position) {
        if configured && self.position == position {
            return
        }
        session.beginConfiguration()
        session.sessionPreset = .photo
        for input in session.inputs { session.removeInput(input) }
        self.position = position
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
           let input = try? AVCaptureDeviceInput(device: device),
           session.canAddInput(input) {
            session.addInput(input)
        }
        if !session.outputs.contains(output), session.canAddOutput(output) {
            session.addOutput(output)
        }
        if output.maxPhotoQualityPrioritization != .speed {
            output.maxPhotoQualityPrioritization = .speed
        }
        session.commitConfiguration()
        configured = session.inputs.isEmpty == false && session.outputs.contains(output)
    }
}

final class LocationFix: NSObject, CLLocationManagerDelegate {
    let manager = CLLocationManager()
    private(set) var last: CLLocation?

    func start() {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        last = locations.last
    }

    /// A fix from the last 15 seconds. The shutter does not wait for GPS.
    func fresh() -> CLLocation? {
        guard let last, last.horizontalAccuracy >= 0 else { return nil }
        if abs(last.timestamp.timeIntervalSinceNow) > 15 { return nil }
        return last
    }
}

final class CaptureViewController: UIViewController {
    var onShot: ((Result<Shot, Error>) -> Void)?
    private let preview = CameraEngine.shared.makePreviewLayer()
    private let location: LocationFix
    private var finished = false

    init(location: LocationFix) {
        self.location = location
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) {
        fatalError("Capture is presented in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        preview.frame = view.bounds
        view.layer.addSublayer(preview)

        let seal = UIButton(type: .system)
        seal.setTitle("SEAL", for: .normal)
        seal.titleLabel?.font = .boldSystemFont(ofSize: 20)
        seal.backgroundColor = .white
        seal.setTitleColor(.black, for: .normal)
        seal.layer.cornerRadius = 8
        seal.addTarget(self, action: #selector(sealTapped), for: .touchUpInside)
        seal.translatesAutoresizingMaskIntoConstraints = false

        let cancel = UIButton(type: .system)
        cancel.setTitle("CANCEL", for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        cancel.translatesAutoresizingMaskIntoConstraints = false

        let hint = UILabel()
        hint.text = "In-app camera. Gallery import is not available."
        hint.textColor = .white
        hint.textAlignment = .center
        hint.font = .systemFont(ofSize: 13)
        hint.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(seal)
        view.addSubview(cancel)
        view.addSubview(hint)
        NSLayoutConstraint.activate([
            seal.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            seal.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            seal.widthAnchor.constraint(equalToConstant: 160),
            seal.heightAnchor.constraint(equalToConstant: 64),
            cancel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            cancel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            hint.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            hint.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            hint.leadingAnchor.constraint(greaterThanOrEqualTo: cancel.trailingAnchor, constant: 8),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview.frame = view.bounds
    }

    @objc private func cancelTapped() {
        finish(.failure(CaptureFailure.cancelled))
    }

    @objc private func sealTapped() {
        view.isUserInteractionEnabled = false
        CameraEngine.shared.take { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .failure(let error):
                    self.finish(.failure(error))
                case .success(let jpeg):
                    self.finish(.success(self.makeShot(jpeg)))
                }
            }
        }
    }

    private func makeShot(_ jpeg: Data) -> Shot {
        let fix = location.fresh()
        var simulated: Bool?
        var api: String?
        if let info = fix?.sourceInformation {
            let software = info.isSimulatedBySoftware
            let accessory = info.isProducedByAccessory
            simulated = software || accessory
            if software { api = "isSimulatedBySoftware" }
            else if accessory { api = "isProducedByAccessory" }
            else { api = "CLLocationSourceInformation" }
        }
        let captured = view.window?.windowScene?.screen.isCaptured ?? false
        return Shot(jpeg: jpeg, location: fix, simulated: simulated, mockApi: api, screenCaptured: captured)
    }

    private func finish(_ result: Result<Shot, Error>) {
        if finished { return }
        finished = true
        dismiss(animated: true) {
            self.onShot?(result)
        }
    }
}
