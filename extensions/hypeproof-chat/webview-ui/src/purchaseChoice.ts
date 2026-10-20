import type { PassProduct } from "../../src/passPurchase";

/**
 * REQ-L12 ② · CONV-PURCHASE-R-002 — the pass shown as chosen on the list: the person's own pick in
 * this view, else the pass the host gave back after the purchase-time sign-in, else the Service's
 * recommendation, else the first. A pick or a restored id the catalogue no longer sells is skipped.
 */
export function chosenPass(products: PassProduct[], picked: string | null, restored: string | undefined): PassProduct | undefined {
  return products.find(p => p.id === picked) ?? products.find(p => p.id === restored) ?? products.find(p => p.recommended) ?? products[0];
}
