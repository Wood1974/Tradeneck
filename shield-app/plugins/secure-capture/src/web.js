import { WebPlugin } from "@capacitor/core";

const UNAVAILABLE = "SecureCapture runs only inside the Shield iOS or Android app. There is no browser camera and no gallery path.";

export class SecureCaptureWeb extends WebPlugin {
  async warmCamera() {
    return;
  }

  async captureAndSeal() {
    throw this.unavailable(UNAVAILABLE);
  }

  async readClock() {
    throw this.unavailable(UNAVAILABLE);
  }

  async signGenesis() {
    throw this.unavailable(UNAVAILABLE);
  }

  async enrollKey() {
    throw this.unavailable(UNAVAILABLE);
  }

  async resetKey() {
    throw this.unavailable(UNAVAILABLE);
  }

  async adoptServerTicket() {
    throw this.unavailable(UNAVAILABLE);
  }

  async listQueue() {
    throw this.unavailable(UNAVAILABLE);
  }

  async exportQueue() {
    throw this.unavailable(UNAVAILABLE);
  }

  async readOriginal() {
    throw this.unavailable(UNAVAILABLE);
  }

  async verifyLocal() {
    throw this.unavailable(UNAVAILABLE);
  }
}
