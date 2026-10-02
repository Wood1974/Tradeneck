// Camera API wrapper for Shield Capture App

class CameraManager {
  constructor(config) {
    this.config = config;
    this.stream = null;
    this.videoElement = null;
    this.canvasElement = null;
  }

  // Check camera availability
  async isAvailable() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(device => device.kind === 'videoinput');
    } catch (error) {
      return false;
    }
  }

  // Initialize camera stream
  async start(videoElement) {
    try {
      this.videoElement = videoElement;

      const constraints = {
        video: {
          facingMode: 'environment', // Back camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoElement.srcObject = this.stream;

      return new Promise((resolve) => {
        videoElement.onloadedmetadata = () => {
          videoElement.play();
          resolve(this.stream);
        };
      });
    } catch (error) {
      throw new Error(`Camera access failed: ${error.message}`);
    }
  }

  // Stop camera stream
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.videoElement = null;
    }
  }

  // Capture photo from video stream
  capturePhoto(canvasElement, videoElement) {
    try {
      const ctx = canvasElement.getContext('2d');
      const video = videoElement || this.videoElement;

      // Set canvas dimensions to match video
      canvasElement.width = video.videoWidth;
      canvasElement.height = video.videoHeight;

      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

      // Convert to blob
      return new Promise((resolve, reject) => {
        canvasElement.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to capture photo'));
          }
        }, 'image/jpeg', 0.9);
      });
    } catch (error) {
      throw error;
    }
  }

  // Convert blob to base64
  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Get photo from file input
  async photoFromFileInput(fileInput) {
    try {
      const file = fileInput.files[0];
      if (!file) {
        throw new Error('No file selected');
      }

      // Check file size
      const maxSizeBytes = this.config.MAX_PHOTO_SIZE_MB * 1024 * 1024;
      if (file.size > maxSizeBytes) {
        throw new Error(`File too large. Max size: ${this.config.MAX_PHOTO_SIZE_MB}MB`);
      }

      return file;
    } catch (error) {
      throw error;
    }
  }
}
