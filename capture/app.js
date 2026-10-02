// Shield Capture App - Main application logic
// State management, API calls, and event handling

class ShieldCaptureApp {
  constructor(config) {
    this.config = config;
    this.storage = new StorageManager(config);
    this.camera = new CameraManager(config);
    this.ui = new UIManager(config);
    this.geolocation = null;

    // State
    this.state = {
      currentPack: null,
      currentNonce: null,
      currentCheckpoint: null,
      captures: [],
      manifestId: null,
      cameraActive: false,
      photoData: null
    };

    this.apiClient = new APIClient(config);
  }

  // Initialize app
  async init() {
    try {
      // Initialize storage
      await this.storage.init();

      // Load fixed packs into storage
      await this.loadFixedPacks();

      // Setup event listeners
      this.setupEventListeners();

      // Render initial UI
      await this.renderPackSelection();
    } catch (error) {
      this.ui.showToast(`Initialization failed: ${error.message}`, 'error');
    }
  }

  // Load fixed packs into storage
  async loadFixedPacks() {
    try {
      for (const pack of this.config.FIXED_PACKS) {
        await this.storage.savePack(pack);
      }
    } catch (error) {
      // Silently fail - packs may already be loaded
    }
  }

  // Setup event listeners
  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('[data-tab-button]').forEach(button => {
      button.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tabButton;
        this.ui.switchTab(tabName);
        this.updateTabAriaAttributes();
      });
    });

    // Pack selection
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-pack-id]')) {
        const packId = e.target.dataset.packId;
        this.startPackCapture(packId);
      }
    });

    // Checkpoint selection
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-checkpoint-id]')) {
        const checkpointId = e.target.dataset.checkpointId;
        this.showCaptureForm(checkpointId);
      }
    });

    // Camera controls
    document.addEventListener('click', (e) => {
      if (e.target.id === 'camera-toggle-btn') {
        this.toggleCamera();
      }
      if (e.target.id === 'capture-photo-btn') {
        this.capturePhotoFromCamera();
      }
      if (e.target.id === 'file-upload-btn') {
        document.getElementById('file-input')?.click();
      }
      if (e.target.id === 'get-gps-btn') {
        this.getGPSLocation();
      }
      if (e.target.id === 'seal-checkpoint-btn') {
        this.sealCheckpoint();
      }
      if (e.target.id === 'cancel-capture-btn') {
        this.cancelCapture();
      }
      if (e.target.id === 'verify-offline-btn') {
        this.verifyOffline();
      }
      if (e.target.id === 'submit-manifest-btn') {
        this.submitManifest();
      }
      if (e.target.id === 'generate-pdf-btn') {
        this.generatePDF();
      }
    });

    // File upload
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        this.handleFileUpload(e);
      });
    }
  }

  // Render pack selection tab
  async renderPackSelection() {
    try {
      const packs = await this.storage.getPacks();
      this.ui.renderPackSelection(packs);
    } catch (error) {
      this.ui.showToast('Failed to load packs', 'error');
    }
  }

  // Start capture for a pack
  async startPackCapture(packId) {
    try {
      this.ui.showLoading(document.getElementById('loading-container'), 'Requesting challenge...');

      // Get pack details
      const packs = await this.storage.getPacks();
      const pack = packs.find(p => p.id === packId);
      if (!pack) {
        throw new Error('Pack not found');
      }

      this.state.currentPack = pack;

      // Request challenge from backend
      const challenge = await this.apiClient.requestChallenge(packId);
      this.state.currentNonce = challenge.nonce;

      // Switch to capture tab
      this.ui.switchTab('capture-session');
      this.updateTabAriaAttributes();

      // Render checkpoint grid
      this.ui.renderCheckpointGrid(pack.checkpoints, this.state.captures);
      this.updateProgress();

      this.ui.hideLoading(document.getElementById('loading-container'));
      this.ui.showToast(`Challenge received for ${pack.name}`, 'success');
    } catch (error) {
      this.ui.hideLoading(document.getElementById('loading-container'));
      this.ui.showToast(`Failed to start capture: ${error.message}`, 'error');
    }
  }

  // Show capture form for checkpoint
  showCaptureForm(checkpointId) {
    try {
      const checkpoint = this.state.currentPack.checkpoints.find(c => c.id === checkpointId);
      if (!checkpoint) {
        throw new Error('Checkpoint not found');
      }

      this.state.currentCheckpoint = checkpoint;
      this.state.photoData = null;

      this.ui.renderCaptureForm(checkpoint);
      this.ui.showModal('Capture Evidence', document.getElementById('checkpoint-form').innerHTML);
    } catch (error) {
      this.ui.showToast('Failed to open capture form', 'error');
    }
  }

  // Toggle camera
  async toggleCamera() {
    try {
      const btn = document.getElementById('camera-toggle-btn');

      if (this.state.cameraActive) {
        this.camera.stop();
        this.state.cameraActive = false;
        btn.textContent = 'Start Camera';
        const preview = document.getElementById('camera-preview');
        if (preview) preview.style.display = 'none';
      } else {
        const videoElement = document.getElementById('camera-preview');
        if (!videoElement) {
          throw new Error('Video element not found');
        }

        const available = await this.camera.isAvailable();
        if (!available) {
          this.ui.showToast('Camera not available on this device', 'error');
          return;
        }

        await this.camera.start(videoElement);
        this.state.cameraActive = true;
        btn.textContent = 'Stop Camera';

        // Enable capture button
        document.getElementById('capture-photo-btn').disabled = false;
      }
    } catch (error) {
      this.ui.showToast(`Camera error: ${error.message}`, 'error');
    }
  }

  // Capture photo from camera
  async capturePhotoFromCamera() {
    try {
      const canvas = document.getElementById('photo-canvas');
      const video = document.getElementById('camera-preview');

      if (!canvas || !video) {
        throw new Error('Canvas or video element not found');
      }

      const photoBlob = await this.camera.capturePhoto(canvas, video);
      this.state.photoData = photoBlob;

      // Show photo preview using shared function
      const reader = new FileReader();
      reader.onload = (e) => {
        this.ui.renderPhotoPreview(e.target.result);
      };
      reader.readAsDataURL(photoBlob);

      this.ui.showToast('Photo captured', 'success');
      document.getElementById('seal-checkpoint-btn').disabled = false;
    } catch (error) {
      this.ui.showToast(`Capture failed: ${error.message}`, 'error');
    }
  }

  // Handle file upload
  async handleFileUpload(event) {
    try {
      const file = event.target.files[0];
      if (!file) return;

      // Check file size
      const maxSizeBytes = this.config.MAX_PHOTO_SIZE_MB * 1024 * 1024;
      if (file.size > maxSizeBytes) {
        this.ui.showToast(`File too large. Max size: ${this.config.MAX_PHOTO_SIZE_MB}MB`, 'error');
        return;
      }

      this.state.photoData = file;

      // Show preview using shared function
      const reader = new FileReader();
      reader.onload = (e) => {
        this.ui.renderPhotoPreview(e.target.result);
      };
      reader.readAsDataURL(file);

      this.ui.showToast('Photo uploaded', 'success');
      document.getElementById('seal-checkpoint-btn').disabled = false;
    } catch (error) {
      this.ui.showToast('File upload failed', 'error');
    }
  }

  // Get GPS location
  async getGPSLocation() {
    try {
      const gpsStatus = document.getElementById('gps-status');
      if (!gpsStatus) return;

      gpsStatus.textContent = 'Getting location...';

      if (this.config.ENABLE_MOCK_GPS && !navigator.geolocation) {
        // Use mock GPS
        this.geolocation = {
          latitude: this.config.MOCK_GPS.latitude,
          longitude: this.config.MOCK_GPS.longitude,
          accuracy: this.config.MOCK_GPS.accuracy,
          timestamp: Date.now()
        };

        // Build status using DOM instead of innerHTML
        gpsStatus.innerHTML = '';
        const mockLabel = document.createElement('p');
        mockLabel.style.color = 'orange';
        mockLabel.textContent = 'Mock Location (Dev Mode)';
        const lat = document.createElement('p');
        lat.textContent = `Latitude: ${this.geolocation.latitude.toFixed(6)}`;
        const lon = document.createElement('p');
        lon.textContent = `Longitude: ${this.geolocation.longitude.toFixed(6)}`;
        const acc = document.createElement('p');
        acc.textContent = `Accuracy: ${this.geolocation.accuracy.toFixed(1)}m`;
        gpsStatus.appendChild(mockLabel);
        gpsStatus.appendChild(lat);
        gpsStatus.appendChild(lon);
        gpsStatus.appendChild(acc);

        this.ui.showToast('Using mock GPS location', 'info');
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.geolocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp
          };

          // Build status using DOM instead of innerHTML
          gpsStatus.innerHTML = '';
          const lat = document.createElement('p');
          lat.textContent = `Latitude: ${this.geolocation.latitude.toFixed(6)}`;
          const lon = document.createElement('p');
          lon.textContent = `Longitude: ${this.geolocation.longitude.toFixed(6)}`;
          const acc = document.createElement('p');
          acc.textContent = `Accuracy: ${this.geolocation.accuracy.toFixed(1)}m`;
          gpsStatus.appendChild(lat);
          gpsStatus.appendChild(lon);
          gpsStatus.appendChild(acc);

          this.ui.showToast('Location captured', 'success');
        },
        (error) => {
          gpsStatus.innerHTML = '';
          const errorMsg = document.createElement('p');
          errorMsg.style.color = 'red';
          errorMsg.textContent = `Failed to get location: ${error.message}`;
          gpsStatus.appendChild(errorMsg);
          this.ui.showToast(`Location error: ${error.message}`, 'error');
        }
      );
    } catch (error) {
      this.ui.showToast('Failed to get location', 'error');
    }
  }

  // Seal checkpoint
  async sealCheckpoint() {
    try {
      if (!this.state.photoData || !this.state.currentCheckpoint || !this.state.currentNonce) {
        this.ui.showToast('Missing required data for sealing', 'error');
        return;
      }

      this.ui.showToast('Sealing checkpoint...', 'info');

      const note = document.getElementById('checkpoint-note')?.value || '';

      // Seal with backend
      const sealResult = await this.apiClient.sealCheckpoint(
        this.state.currentPack.id,
        this.state.currentCheckpoint.id,
        this.state.photoData,
        note,
        this.state.currentNonce,
        this.geolocation
      );

      // Store capture locally
      const photoDataUrl = await this.blobToDataUrl(this.state.photoData);
      const capture = {
        pack_id: this.state.currentPack.id,
        checkpoint_name: this.state.currentCheckpoint.id,
        photo_data: this.state.photoData,
        photo_data_url: photoDataUrl,
        note,
        nonce: this.state.currentNonce,
        gps_lat: this.geolocation?.latitude,
        gps_lon: this.geolocation?.longitude,
        gps_accuracy: this.geolocation?.accuracy,
        seal_ok: sealResult.ok,
        seal_response: sealResult,
        created_at: new Date().toISOString()
      };

      await this.storage.saveCapture(capture);
      this.state.captures.push(capture);

      this.ui.showToast('Checkpoint sealed successfully', 'success');
      this.cancelCapture();
      this.updateProgress();

      // Re-render checkpoint grid
      this.ui.renderCheckpointGrid(this.state.currentPack.checkpoints, this.state.captures);
    } catch (error) {
      this.ui.showToast(`Sealing failed: ${error.message}`, 'error');
    }
  }

  // Cancel capture
  cancelCapture() {
    if (this.state.cameraActive) {
      this.camera.stop();
      this.state.cameraActive = false;
    }

    this.state.currentCheckpoint = null;
    this.state.photoData = null;
    this.geolocation = null;

    // Close modal if open
    const modal = document.querySelector('.modal');
    if (modal) {
      modal.remove();
    }
  }

  // Verify offline
  async verifyOffline() {
    try {
      this.ui.showToast('Verifying captures...', 'info');

      const verifyResult = await this.apiClient.verifyOffline(
        this.state.currentPack.id,
        this.state.captures,
        this.state.currentNonce
      );

      this.ui.renderVerificationResults(verifyResult);

      if (verifyResult.valid) {
        this.ui.showToast('Verification passed', 'success');
        this.ui.enableButton('#submit-manifest-btn');
      } else {
        this.ui.showToast('Verification failed - check results', 'error');
      }
    } catch (error) {
      this.ui.showToast(`Verification failed: ${error.message}`, 'error');
    }
  }

  // Submit manifest
  async submitManifest() {
    try {
      this.ui.showToast('Submitting manifest...', 'info');

      const result = await this.apiClient.submitManifest(
        this.state.currentPack.id,
        this.state.captures,
        this.state.currentNonce
      );

      this.state.manifestId = result.manifest_id;

      // Save manifest to storage
      const manifest = {
        id: result.manifest_id,
        pack_id: this.state.currentPack.id,
        nonce: this.state.currentNonce,
        capture_ids: this.state.captures.map(c => c.id),
        created_at: new Date().toISOString()
      };
      await this.storage.saveManifest(manifest);

      // Switch to export tab
      this.ui.switchTab('export');
      this.updateTabAriaAttributes();
      this.ui.renderPDFExport(result.manifest_id);

      this.ui.showToast('Manifest submitted successfully', 'success');
    } catch (error) {
      this.ui.showToast(`Submission failed: ${error.message}`, 'error');
    }
  }

  // Generate PDF
  async generatePDF() {
    try {
      if (!this.state.manifestId) {
        this.ui.showToast('No manifest ID available', 'error');
        return;
      }

      this.ui.showToast('Generating PDF...', 'info');

      const pdfBlob = await this.apiClient.getPDF(this.state.manifestId);

      // Create download link
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `manifest-${this.state.manifestId}.pdf`;
      link.click();
      URL.revokeObjectURL(url);

      this.ui.showToast('PDF downloaded', 'success');
    } catch (error) {
      this.ui.showToast(`PDF generation failed: ${error.message}`, 'error');
    }
  }

  // Update progress
  updateProgress() {
    const completed = this.state.captures.length;
    const total = this.state.currentPack?.checkpoints.length || 0;
    this.ui.updateProgress(completed, total);

    // Update progress bar ARIA attributes
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) {
      progressBar.setAttribute('aria-valuenow', completed);
      progressBar.setAttribute('aria-valuemax', total);
    }
  }

  // Update tab ARIA attributes
  updateTabAriaAttributes() {
    document.querySelectorAll('[role="tab"]').forEach(tab => {
      const isActive = tab.classList.contains('active');
      tab.setAttribute('aria-selected', isActive.toString());
    });
  }

  // Convert blob to data URL
  async blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }
}

// API Client for backend communication
class APIClient {
  constructor(config) {
    this.config = config;
    this.baseURL = config.API_BASE_URL;
  }

  // Request challenge (nonce) from backend
  async requestChallenge(packId) {
    try {
      const response = await fetch(`${this.baseURL}/api/challenges/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_id: packId })
      });

      if (!response.ok) {
        throw new Error(`Challenge request failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  // Seal checkpoint with photo and metadata
  async sealCheckpoint(packId, checkpointId, photoBlob, note, nonce, gps) {
    try {
      const formData = new FormData();
      formData.append('photo', photoBlob);
      formData.append('checkpoint_name', checkpointId);
      formData.append('note', note);
      formData.append('nonce', nonce);

      if (gps) {
        formData.append('gps_lat', gps.latitude);
        formData.append('gps_lon', gps.longitude);
        formData.append('gps_accuracy', gps.accuracy);
      }

      const response = await fetch(`${this.baseURL}/api/captures/${packId}/seal`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Seal failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  // Verify offline
  async verifyOffline(packId, captures, nonce) {
    try {
      const response = await fetch(`${this.baseURL}/api/captures/${packId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captures: captures.map(c => ({
            checkpoint_name: c.checkpoint_name,
            nonce: c.nonce,
            seal_response: c.seal_response
          })),
          nonce
        })
      });

      if (!response.ok) {
        throw new Error(`Verification failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  // Submit manifest
  async submitManifest(packId, captures, nonce) {
    try {
      const response = await fetch(`${this.baseURL}/api/manifests/${packId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captures: captures.map(c => ({
            checkpoint_name: c.checkpoint_name,
            nonce: c.nonce,
            seal_response: c.seal_response
          })),
          nonce
        })
      });

      if (!response.ok) {
        throw new Error(`Submit failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  // Get PDF
  async getPDF(manifestId) {
    try {
      const response = await fetch(`${this.baseURL}/api/manifests/${manifestId}/pdf`);

      if (!response.ok) {
        throw new Error(`PDF request failed: ${response.statusText}`);
      }

      return await response.blob();
    } catch (error) {
      throw error;
    }
  }
}

// Initialize app when DOM is ready
(function initializeApp() {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new ShieldCaptureApp(CONFIG);
    app.init();
  });
})();
