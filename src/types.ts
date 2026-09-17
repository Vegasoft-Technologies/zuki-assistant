export type CurrencyCode = "GBP";

export type PricingKind =
  | "base"
  | "quantity"
  | "bundle"
  | "size"
  | "service_mode"
  | "volume"
  | "variant"
  | "surcharge"
  | "unlabelled";

export type PricingEffect = "absolute" | "surcharge";

export type PricingEvidenceSource =
  | "item_price"
  | "item_name"
  | "item_description"
  | "section_pricing"
  | "section_price_order"
  | "section_extras"
  | "section_mini_bottles"
  | "menu_service";

export interface PricingQualifiers {
  quantity?: number;
  unit?: string;
  size?: string;
  serviceMode?: string;
  volumeMl?: number;
  variant?: string;
  optionIndex?: number;
}

export interface PricingEvidence {
  source: PricingEvidenceSource;
  sourcePath: string;
  rawText: string;
}

export interface PricingAmbiguity {
  status: "unresolved";
  reason: string;
}

export interface PricingOption {
  kind: PricingKind;
  amount: number;
  amountMinor: number;
  pricingEffect: PricingEffect;
  qualifiers: PricingQualifiers;

  evidence: PricingEvidence;

  qualifierEvidence?: PricingEvidence;

  ambiguity?: PricingAmbiguity;
}

export interface Pricing {
  currency: CurrencyCode;
  rawPriceText: string;
  options: PricingOption[];
}