import type { components } from '../../../packages/contracts/api';

type Offer = components['schemas']['Opportunity'];

// El motor marca la ausencia de cifra con estas etiquetas; no es una compensación publicada.
export const hasPay = (offer: Offer) => Boolean(offer.compensation?.trim()) && !/^(importe no publicado|no especificado)/i.test(offer.compensation.trim());
