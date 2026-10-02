// Configuration for Shield Evidence Capture App

const CONFIG = {
  // Backend API base URL
  API_BASE_URL: 'https://tradedeck-api.onrender.com',

  // Fixed packs (predefined evidence collections)
  FIXED_PACKS: [
    {
      id: 'remodel',
      name: 'Remodel Package',
      description: 'Before/after photos for home renovation projects',
      pointCount: 8,
      checkpoints: [
        { id: 'before_exterior', name: 'Before - Exterior' },
        { id: 'before_interior', name: 'Before - Interior' },
        { id: 'demo_phase', name: 'Demolition Phase' },
        { id: 'framing', name: 'Framing' },
        { id: 'electrical', name: 'Electrical/Plumbing' },
        { id: 'drywall', name: 'Drywall Installation' },
        { id: 'finish_details', name: 'Finish Details' },
        { id: 'after_complete', name: 'After - Complete' }
      ]
    },
    {
      id: 'lender_draw',
      name: 'Lender Draw Package',
      description: 'Draw inspection evidence for construction financing',
      pointCount: 6,
      checkpoints: [
        { id: 'foundation', name: 'Foundation Complete' },
        { id: 'framing_complete', name: 'Framing Complete' },
        { id: 'mechanical', name: 'Mechanical/Rough Inspection' },
        { id: 'exterior', name: 'Exterior Weather-Tight' },
        { id: 'drywall_complete', name: 'Drywall Complete' },
        { id: 'final_inspection', name: 'Final Inspection' }
      ]
    },
    {
      id: 'insurance_loss',
      name: 'Insurance Claim Package',
      description: 'Documentation for insurance claim processing',
      pointCount: 5,
      checkpoints: [
        { id: 'damage_overview', name: 'Overall Damage' },
        { id: 'structural', name: 'Structural Damage' },
        { id: 'contents', name: 'Contents Damage' },
        { id: 'measurements', name: 'Area Measurements' },
        { id: 'final_assessment', name: 'Final Assessment' }
      ]
    },
    {
      id: 'rental_unit',
      name: 'Rental Unit Inspection',
      description: 'Move-in/move-out inspection documentation',
      pointCount: 7,
      checkpoints: [
        { id: 'exterior', name: 'Exterior Condition' },
        { id: 'entry', name: 'Entry/Hallway' },
        { id: 'living', name: 'Living Areas' },
        { id: 'kitchen', name: 'Kitchen' },
        { id: 'bathrooms', name: 'Bathrooms' },
        { id: 'bedrooms', name: 'Bedrooms' },
        { id: 'appliances', name: 'Appliances/Fixtures' }
      ]
    },
    {
      id: 'auto_shop',
      name: 'Auto Repair Documentation',
      description: 'Before/during/after photos for vehicle repairs',
      pointCount: 5,
      checkpoints: [
        { id: 'intake_condition', name: 'Intake Condition' },
        { id: 'damage_detail', name: 'Damage Detail' },
        { id: 'repair_progress', name: 'Repair Progress' },
        { id: 'parts_installed', name: 'Parts Installed' },
        { id: 'final_quality', name: 'Final Quality Check' }
      ]
    }
  ],

  // IndexedDB configuration
  DB_NAME: 'ShieldCaptureDB',
  DB_VERSION: 1,
  STORES: {
    PACKS: 'packs',
    CAPTURES: 'captures',
    MANIFESTS: 'manifests'
  },

  // Challenge/nonce expiration (minutes)
  CHALLENGE_EXPIRY_MINUTES: 30,

  // GPS mock coordinates for development (Times Square, NYC)
  MOCK_GPS: {
    latitude: 40.7128,
    longitude: -74.0060,
    accuracy: 5
  },

  // Photo size limits
  MAX_PHOTO_SIZE_MB: 10,
  MAX_NOTE_LENGTH: 1000,

  // UI constants
  TOAST_DURATION_MS: 3000,
  PROGRESS_UPDATE_INTERVAL_MS: 500,

  // Feature flags
  ENABLE_MOCK_GPS: true,
  ENABLE_OFFLINE_MODE: true,
  ENABLE_DEVICE_BINDING: false
};

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
