export const TEST_DATA = {
  // Phone numbers
  phone: {
    primary: '+966501234567',
    primaryNormalized: '966501234567',
    secondary: '+1234567890',
    secondaryNormalized: '1234567890',
    tertiary: '966509876543',
    minimal: '1',
  },

  // Message IDs
  messageId: {
    test: 'wamid.test',
    original: 'wamid.original',
    abc: 'wamid.abc',
    abc123: 'wamid.abc123',
    cloud: 'wamid.cloud',
    wati: 'wati-msg-1',
    wati123: 'wati-msg-123',
    d360: 'wamid.360',
    img: 'wamid.img123',
    status: 'wamid.status123',
    error: 'wamid.err123',
    local: 'local-123',
  },

  // Media IDs
  mediaId: {
    media123: 'media-123',
    media456: 'media-456',
    sticker123: 'sticker-123',
  },

  // Provider Configs
  config: {
    wati: {
      apiKey: 'wati_de45d51e-961d-4acf-9c9c-9246de839623.pUh8lFQrKl2Tif5jWiqBn-lStX7JPhXIAGfrnbbBrLD1lQKyvnOh4hVdiuJ4B1QMxuZy3xcMGX7UG3Fl6QGPaL_EQUigOKjP12tdGF_W-Yi-PJu4gZWPaUvcNf63xwoY',
      baseUrl: 'https://live-mt-server.wati.io/10144080',
      channelNumber: '201012345678',
      webhookSecret: 'wati-webhook-secret',
    },
    cloudApi: {
      phoneNumberId: 'phone-123',
      accessToken: 'EAAx-test-token',
      appSecret: 'test-app-secret',
      webhookVerifyToken: 'verify-me',
      wabaId: 'waba-456',
    },
    dialog360: {
      apiKey: 'test-api-key-360',
      webhookSecret: 'webhook-secret-360',
    }
  }
} as const;
