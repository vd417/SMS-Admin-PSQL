const apiBaseUrl = import.meta.env.VITE_API_BASE ?? 'https://api.sms.catretech.me/v1'

export const config = { apiBaseUrl } as const
