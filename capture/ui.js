// UI Manager for Shield Capture App
// Handles DOM manipulation, tab switching, and rendering

class UIManager {
  constructor(config) {
    this.config = config;
    this.currentTab = 'pack-selection';
    this.toastTimeout = null;
  }

  // Show a toast notification
  showToast(message, type = 'info', duration = null) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    const removeDuration = duration || this.config.TOAST_DURATION_MS;
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, removeDuration);

    return toast;
  }

  // Switch to a specific tab
  switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('[data-tab-content]').forEach(tab => {
      tab.classList.remove('active');
    });

    // Deactivate all tab buttons
    document.querySelectorAll('[data-tab-button]').forEach(btn => {
      btn.classList.remove('active');
    });

    // Show selected tab
    const tabContent = document.querySelector(`[data-tab-content="${tabName}"]`);
    if (tabContent) {
      tabContent.classList.add('active');
    }

    // Activate selected tab button
    const tabButton = document.querySelector(`[data-tab-button="${tabName}"]`);
    if (tabButton) {
      tabButton.classList.add('active');
    }

    this.currentTab = tabName;
  }

  // Render pack selection list
  renderPackSelection(packs) {
    const container = document.getElementById('pack-list');
    if (!container) return;

    container.innerHTML = '';

    packs.forEach((pack, index) => {
      const packElement = document.createElement('div');
      packElement.className = 'pack-card';

      const header = document.createElement('div');
      header.className = 'pack-header';

      const title = document.createElement('h3');
      title.textContent = pack.name;

      const points = document.createElement('span');
      points.className = 'pack-points';
      points.setAttribute('aria-label', `${pack.pointCount} checkpoints in this package`);
      points.textContent = `${pack.pointCount} points`;

      header.appendChild(title);
      header.appendChild(points);
      packElement.appendChild(header);

      const desc = document.createElement('p');
      desc.className = 'pack-description';
      desc.textContent = pack.description;
      packElement.appendChild(desc);

      const button = document.createElement('button');
      button.className = 'btn btn-primary';
      button.dataset.packId = pack.id;
      button.setAttribute('aria-label', `Start capturing evidence for ${pack.name}`);
      button.textContent = 'Start Capture';
      packElement.appendChild(button);

      container.appendChild(packElement);
    });
  }

  // Render capture checkpoints grid
  renderCheckpointGrid(checkpoints, captures = []) {
    const container = document.getElementById('checkpoint-grid');
    if (!container) return;

    container.innerHTML = '';

    const captureMap = new Map(captures.map(c => [c.checkpoint_name, c]));

    checkpoints.forEach((checkpoint, index) => {
      const capture = captureMap.get(checkpoint.id);
      const checkpointElement = document.createElement('div');
      checkpointElement.className = 'checkpoint-card';
      checkpointElement.dataset.checkpointId = checkpoint.id;

      const content = document.createElement('div');
      content.className = 'checkpoint-content';

      const heading = document.createElement('h4');
      heading.textContent = checkpoint.name;
      content.appendChild(heading);

      const statusDiv = document.createElement('div');
      statusDiv.className = 'checkpoint-status';

      const status = document.createElement('span');
      let statusText = 'Not Started';
      let statusClass = 'status-pending';

      if (capture) {
        if (capture.seal_ok === true) {
          statusText = 'Sealed';
          statusClass = 'status-sealed';
        } else if (capture.seal_ok === false) {
          statusText = 'Error';
          statusClass = 'status-error';
        } else {
          statusText = 'Pending Seal';
          statusClass = 'status-pending';
        }
      }

      status.className = `status ${statusClass}`;
      status.textContent = statusText;
      statusDiv.appendChild(status);
      content.appendChild(statusDiv);
      checkpointElement.appendChild(content);

      const button = document.createElement('button');
      button.className = 'btn btn-small';
      button.dataset.checkpointId = checkpoint.id;
      const buttonText = capture ? 'Edit' : 'Capture';
      button.setAttribute('aria-label', `${buttonText} evidence for ${checkpoint.name}`);
      button.textContent = buttonText;
      checkpointElement.appendChild(button);

      container.appendChild(checkpointElement);
    });
  }

  // Render capture form
  renderCaptureForm(checkpoint) {
    const form = document.getElementById('checkpoint-form');
    if (!form) return;

    form.innerHTML = `
      <div class="form-group">
        <label id="checkpoint-label">Checkpoint: ${this.escapeHtml(checkpoint.name)}</label>
      </div>

      <div class="form-group">
        <label for="photo-input">Photo</label>
        <div class="photo-preview-container">
          <video id="camera-preview" class="camera-preview" playsinline aria-label="Live camera preview"></video>
          <canvas id="photo-canvas" style="display: none;"></canvas>
          <div id="photo-preview" class="photo-preview" style="display: none;" role="img" aria-label="Photo preview"></div>
        </div>
        <div class="button-group">
          <button id="camera-toggle-btn" class="btn btn-secondary" aria-label="Start or stop camera">Start Camera</button>
          <button id="capture-photo-btn" class="btn btn-secondary" disabled aria-label="Capture photo from camera">Capture Photo</button>
          <button id="file-upload-btn" class="btn btn-secondary" aria-label="Upload photo from device">Upload Photo</button>
        </div>
        <input id="file-input" type="file" accept="image/*" style="display: none;" aria-label="File upload input">
      </div>

      <div class="form-group">
        <label for="checkpoint-note">Note (optional)</label>
        <textarea id="checkpoint-note" maxlength="${this.config.MAX_NOTE_LENGTH}"
                  placeholder="Add details about this checkpoint..." aria-label="Add optional notes about this checkpoint"></textarea>
        <span class="char-count"><span id="char-count" aria-live="polite" aria-label="Character count">0</span>/${this.config.MAX_NOTE_LENGTH}</span>
      </div>

      <div class="form-group">
        <label>Location</label>
        <div class="location-info">
          <button id="get-gps-btn" class="btn btn-secondary" aria-label="Get current GPS location">Get GPS Location</button>
          <div id="gps-status" style="margin-top: 10px; font-size: 0.9em;" aria-live="polite" aria-label="GPS status"></div>
        </div>
      </div>

      <div class="button-group" style="margin-top: 20px;">
        <button id="cancel-capture-btn" class="btn btn-secondary" aria-label="Cancel capture without saving">Cancel</button>
        <button id="seal-checkpoint-btn" class="btn btn-primary" disabled aria-label="Seal this checkpoint with captured photo">Seal Checkpoint</button>
      </div>
    `;

    // Setup event listeners
    this.setupCaptureFormEvents();
  }

  // Setup capture form event listeners
  setupCaptureFormEvents() {
    const noteInput = document.getElementById('checkpoint-note');
    const charCount = document.getElementById('char-count');

    if (noteInput && charCount) {
      noteInput.addEventListener('input', () => {
        charCount.textContent = noteInput.value.length;
      });
    }
  }

  // Render manifest review
  renderManifestReview(captures, checkpoints) {
    const container = document.getElementById('manifest-content');
    if (!container) return;

    container.innerHTML = '';

    const captureMap = new Map(captures.map(c => [c.checkpoint_name, c]));

    checkpoints.forEach(checkpoint => {
      const capture = captureMap.get(checkpoint.id);
      if (!capture) return;

      const reviewItem = document.createElement('div');
      reviewItem.className = 'review-item';

      const header = document.createElement('div');
      header.className = 'review-header';

      const title = document.createElement('h4');
      title.textContent = checkpoint.name;

      const statusClass = capture.seal_ok ? 'success' : 'error';
      const statusText = capture.seal_ok ? 'Sealed' : 'Not Sealed';
      const status = document.createElement('span');
      status.className = `status status-${statusClass}`;
      status.textContent = statusText;

      header.appendChild(title);
      header.appendChild(status);
      reviewItem.appendChild(header);

      if (capture.photo_data_url) {
        const img = document.createElement('img');
        img.src = capture.photo_data_url;
        img.alt = checkpoint.name;
        img.className = 'review-photo';
        reviewItem.appendChild(img);
      }

      if (capture.note) {
        const noteDiv = document.createElement('p');
        noteDiv.className = 'review-note';
        const noteLabel = document.createElement('strong');
        noteLabel.textContent = 'Note: ';
        const noteText = document.createTextNode(capture.note);
        noteDiv.appendChild(noteLabel);
        noteDiv.appendChild(noteText);
        reviewItem.appendChild(noteDiv);
      }

      if (capture.gps_lat && capture.gps_lon) {
        const gpsDiv = document.createElement('p');
        gpsDiv.className = 'review-gps';
        const gpsLabel = document.createElement('strong');
        gpsLabel.textContent = 'Location: ';
        const coords = `${capture.gps_lat.toFixed(6)}, ${capture.gps_lon.toFixed(6)}`;
        const accuracy = capture.gps_accuracy ? ` (accuracy: ${capture.gps_accuracy.toFixed(1)}m)` : '';
        gpsDiv.appendChild(gpsLabel);
        gpsDiv.appendChild(document.createTextNode(coords + accuracy));
        reviewItem.appendChild(gpsDiv);
      }

      const timestamp = document.createElement('p');
      timestamp.className = 'review-timestamp';
      const small = document.createElement('small');
      small.textContent = `Captured: ${new Date(capture.created_at).toLocaleString()}`;
      timestamp.appendChild(small);
      reviewItem.appendChild(timestamp);

      container.appendChild(reviewItem);
    });
  }

  // Render verification results
  renderVerificationResults(results) {
    const container = document.getElementById('verification-results');
    if (!container) return;

    container.innerHTML = '';

    if (!results || !results.checks) {
      const noResults = document.createElement('p');
      noResults.textContent = 'No verification results available';
      container.appendChild(noResults);
      return;
    }

    const checksDiv = document.createElement('div');
    checksDiv.className = 'verification-checks';

    results.checks.forEach(check => {
      const checkElement = document.createElement('div');
      checkElement.className = `check-item ${check.passed ? 'passed' : 'failed'}`;
      checkElement.setAttribute('role', 'listitem');

      const icon = document.createElement('span');
      icon.className = 'check-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = check.passed ? '✓' : '✗';

      const name = document.createElement('span');
      name.className = 'check-name';
      name.textContent = check.name;

      checkElement.appendChild(icon);
      checkElement.appendChild(name);

      if (check.detail) {
        const detail = document.createElement('span');
        detail.className = 'check-detail';
        detail.textContent = check.detail;
        checkElement.appendChild(detail);
      }

      checksDiv.appendChild(checkElement);
    });

    checksDiv.setAttribute('role', 'list');
    container.appendChild(checksDiv);

    const summary = document.createElement('div');
    summary.className = 'verification-summary';
    const passed = results.checks.filter(c => c.passed).length;

    const resultText = document.createElement('strong');
    resultText.textContent = `Result: ${passed}/${results.checks.length} checks passed`;
    summary.appendChild(resultText);

    const statusMsg = document.createElement('p');
    statusMsg.className = results.valid ? 'success' : 'error';
    statusMsg.textContent = results.valid
      ? 'Manifest is valid and ready to submit'
      : 'Please review failed checks before submitting';
    summary.appendChild(statusMsg);

    container.appendChild(summary);
  }

  // Render PDF export section
  renderPDFExport(manifestId) {
    const container = document.getElementById('pdf-content');
    if (!container) return;

    container.innerHTML = '';

    const section = document.createElement('div');
    section.className = 'pdf-section';

    const heading = document.createElement('h3');
    heading.textContent = 'Export Evidence Manifest';
    section.appendChild(heading);

    const desc = document.createElement('p');
    desc.textContent = 'Generate a PDF report with all captured evidence and verification results.';
    section.appendChild(desc);

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'button-group';

    const btn = document.createElement('button');
    btn.id = 'generate-pdf-btn';
    btn.className = 'btn btn-primary';
    btn.dataset.manifestId = manifestId;
    btn.setAttribute('aria-label', 'Generate and download PDF report');
    btn.textContent = 'Generate PDF';
    buttonGroup.appendChild(btn);
    section.appendChild(buttonGroup);

    const status = document.createElement('div');
    status.id = 'pdf-status';
    status.style.marginTop = '20px';
    status.setAttribute('aria-live', 'polite');
    section.appendChild(status);

    const preview = document.createElement('div');
    preview.id = 'pdf-preview';
    preview.style.marginTop = '20px';
    section.appendChild(preview);

    container.appendChild(section);
  }

  // Update progress bar
  updateProgress(completed, total) {
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    if (progressBar) {
      const percentage = Math.round((completed / total) * 100);
      progressBar.style.width = percentage + '%';
    }

    if (progressText) {
      progressText.textContent = `${completed}/${total} checkpoints completed`;
    }
  }

  // Show loading state
  showLoading(element, message = 'Loading...') {
    if (!element) return;
    element.innerHTML = `<div class="spinner"></div><p>${this.escapeHtml(message)}</p>`;
    element.classList.add('loading');
  }

  // Hide loading state
  hideLoading(element) {
    if (!element) return;
    element.classList.remove('loading');
  }

  // Escape HTML to prevent XSS
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Render photo preview (shared logic for camera and file upload)
  renderPhotoPreview(dataUrl) {
    const preview = document.getElementById('photo-preview');
    if (!preview) return;

    // Clear previous content
    preview.innerHTML = '';

    // Create image element
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Photo preview';

    // Add to preview container
    preview.appendChild(img);
    preview.style.display = 'block';

    // Hide camera preview if visible
    const videoPreview = document.getElementById('camera-preview');
    if (videoPreview) {
      videoPreview.style.display = 'none';
    }
  }

  // Show modal
  showModal(title, content) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const modalId = 'modal-' + Date.now();
    modal.setAttribute('aria-labelledby', modalId);

    // Create structure with textContent for title to prevent XSS
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';

    const heading = document.createElement('h3');
    heading.id = modalId;
    heading.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close dialog');

    modalHeader.appendChild(heading);
    modalHeader.appendChild(closeBtn);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    // Content is passed as HTML string from form, append it safely
    modalBody.innerHTML = content;

    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modal.appendChild(modalContent);

    document.body.appendChild(modal);

    closeBtn.addEventListener('click', () => {
      modal.remove();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });

    return modal;
  }

  // Disable button
  disableButton(selector) {
    const btn = document.querySelector(selector);
    if (btn) {
      btn.disabled = true;
      btn.classList.add('disabled');
    }
  }

  // Enable button
  enableButton(selector) {
    const btn = document.querySelector(selector);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled');
    }
  }
}
