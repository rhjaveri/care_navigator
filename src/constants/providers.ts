export const PROVIDER_URLS = {
  'unitedhealthcare': 'https://www.uhc.com/find-a-doctor',
  'aetna': 'https://www.aetna.com/dsepublic/#/contentPage?page=providerSearchLanding',
  'cigna': 'https://hcpdirectory.cigna.com/web/public/consumer/directory'
} as const;

export type ProviderKey = keyof typeof PROVIDER_URLS; 