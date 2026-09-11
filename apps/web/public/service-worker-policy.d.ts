export const NETWORK_ONLY: "NETWORK_ONLY";
export const SHELL_NETWORK_FIRST: "SHELL_NETWORK_FIRST";
export const STATIC_NETWORK_FIRST: "STATIC_NETWORK_FIRST";

export interface ServiceWorkerRequestMetadata {
  destination: string;
  method: string;
  mode: string;
  url: string;
}

export function serviceWorkerRequestStrategy(
  request: ServiceWorkerRequestMetadata,
  appOrigin: string,
): typeof NETWORK_ONLY | typeof SHELL_NETWORK_FIRST | typeof STATIC_NETWORK_FIRST;

export function isCacheableStaticResponse(response: Response): boolean;
