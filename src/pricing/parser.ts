import type {
  Pricing,
  PricingEffect,
  PricingEvidence,
  PricingKind,
  PricingOption,
  PricingQualifiers,
} from "../types.js";

export interface ParsePrimaryPriceInput {
  rawPriceText: string;
  sourcePath: string;

  itemName: string;
  itemNameSourcePath: string;

  description: string | null;
  descriptionSourcePath: string;

  sectionPriceOrder?: readonly string[];
  sectionPriceOrderSourcePath?: string;
}

interface ParsedMoney {
  amount: number;
  amountMinor: number;
  pricingEffect: PricingEffect;
}

function poundsToMinorUnits(value: string): number {
  const [wholePart, decimalPart = ""] = value.split(".");

  const whole = Number.parseInt(wholePart ?? "", 10);

  if (!Number.isInteger(whole) || whole < 0) {
    throw new Error(`Invalid pound amount: ${value}`);
  }

  if (!/^\d{0,2}$/.test(decimalPart)) {
    throw new Error(`Invalid pound decimal amount: ${value}`);
  }

  const paddedDecimal = decimalPart.padEnd(2, "0");

  const pence =
    paddedDecimal.length === 0
      ? 0
      : Number.parseInt(paddedDecimal, 10);

  return whole * 100 + pence;
}

export function parseMoneyToken(rawToken: string): ParsedMoney | null {
  const token = rawToken.trim();

  const poundMatch = token.match(
    /^(\+)?£(\d+(?:\.\d{1,2})?)$/,
  );

  if (poundMatch !== null) {
    const value = poundMatch[2];

    if (value === undefined) {
      return null;
    }

    const amountMinor = poundsToMinorUnits(value);

    return {
      amount: amountMinor / 100,
      amountMinor,
      pricingEffect:
        poundMatch[1] === "+"
          ? "surcharge"
          : "absolute",
    };
  }

  const penceMatch = token.match(
    /^(\+)?(\d+)p$/i,
  );

  if (penceMatch !== null) {
    const value = penceMatch[2];

    if (value === undefined) {
      return null;
    }

    const amountMinor = Number.parseInt(value, 10);

    return {
      amount: amountMinor / 100,
      amountMinor,
      pricingEffect:
        penceMatch[1] === "+"
          ? "surcharge"
          : "absolute",
    };
  }

  return null;
}

function createPriceEvidence(
  sourcePath: string,
  rawText: string,
): PricingEvidence {
  return {
    source: "item_price",
    sourcePath,
    rawText,
  };
}

function createOption(
  money: ParsedMoney,
  kind: PricingKind,
  qualifiers: PricingQualifiers,
  sourcePath: string,
  rawText: string,
  qualifierEvidence?: PricingEvidence,
): PricingOption {
  const option: PricingOption = {
    kind,
    amount: money.amount,
    amountMinor: money.amountMinor,
    pricingEffect: money.pricingEffect,
    qualifiers,
    evidence: createPriceEvidence(
      sourcePath,
      rawText,
    ),
  };

  if (qualifierEvidence !== undefined) {
    option.qualifierEvidence = qualifierEvidence;
  }

  return option;
}

function parseQuantityParts(
  parts: readonly string[],
  sourcePath: string,
): PricingOption[] | null {
  const options: PricingOption[] = [];

  for (const part of parts) {
    const match = part.match(
      /^(\d+)\s+scoops?\s+(\+?£\d+(?:\.\d{1,2})?)$/i,
    );

    if (match === null) {
      return null;
    }

    const quantityText = match[1];
    const moneyText = match[2];

    if (
      quantityText === undefined ||
      moneyText === undefined
    ) {
      return null;
    }

    const money = parseMoneyToken(moneyText);

    if (money === null) {
      return null;
    }

    options.push(
      createOption(
        money,
        "quantity",
        {
          quantity: Number.parseInt(
            quantityText,
            10,
          ),
          unit: "scoop",
        },
        sourcePath,
        part,
      ),
    );
  }

  return options;
}

function parseBundleParts(
  parts: readonly string[],
  sourcePath: string,
): PricingOption[] | null {
  const options: PricingOption[] = [];

  for (const part of parts) {
    const match = part.match(
      /^for\s+(\d+)\s+(\+?£\d+(?:\.\d{1,2})?)$/i,
    );

    if (match === null) {
      return null;
    }

    const quantityText = match[1];
    const moneyText = match[2];

    if (
      quantityText === undefined ||
      moneyText === undefined
    ) {
      return null;
    }

    const money = parseMoneyToken(moneyText);

    if (money === null) {
      return null;
    }

    options.push(
      createOption(
        money,
        "bundle",
        {
          quantity: Number.parseInt(
            quantityText,
            10,
          ),
        },
        sourcePath,
        part,
      ),
    );
  }

  return options;
}

function parseServiceModeParts(
  parts: readonly string[],
  sourcePath: string,
): PricingOption[] | null {
  const options: PricingOption[] = [];

  for (const part of parts) {
    const match = part.match(
      /^(\+?£\d+(?:\.\d{1,2})?)\s+(eat in|takeaway)$/i,
    );

    if (match === null) {
      return null;
    }

    const moneyText = match[1];
    const serviceMode = match[2];

    if (
      moneyText === undefined ||
      serviceMode === undefined
    ) {
      return null;
    }

    const money = parseMoneyToken(moneyText);

    if (money === null) {
      return null;
    }

    options.push(
      createOption(
        money,
        "service_mode",
        {
          serviceMode:
            serviceMode.toLowerCase(),
        },
        sourcePath,
        part,
      ),
    );
  }

  return options;
}

function parseSizeParts(
  parts: readonly string[],
  sourcePath: string,
): PricingOption[] | null {
  const options: PricingOption[] = [];

  for (const part of parts) {
    const match = part.match(
      /^(regular|large)\s+(\+?£\d+(?:\.\d{1,2})?)$/i,
    );

    if (match === null) {
      return null;
    }

    const size = match[1];
    const moneyText = match[2];

    if (
      size === undefined ||
      moneyText === undefined
    ) {
      return null;
    }

    const money = parseMoneyToken(moneyText);

    if (money === null) {
      return null;
    }

    options.push(
      createOption(
        money,
        "size",
        {
          size: size.toLowerCase(),
        },
        sourcePath,
        part,
      ),
    );
  }

  return options;
}

function createOptionFromLabel(
  money: ParsedMoney,
  label: string,
  sourcePath: string,
  rawPriceText: string,
  qualifierEvidence: PricingEvidence,
): PricingOption {
  const normalizedLabel =
    label.trim().toLowerCase();

  if (
    normalizedLabel === "regular" ||
    normalizedLabel === "large"
  ) {
    return createOption(
      money,
      "size",
      {
        size: normalizedLabel,
      },
      sourcePath,
      rawPriceText,
      qualifierEvidence,
    );
  }

  const volumeMatch =
    normalizedLabel.match(/^(\d+)ml$/);

  if (volumeMatch !== null) {
    const volumeText = volumeMatch[1];

    if (volumeText !== undefined) {
      return createOption(
        money,
        "volume",
        {
          volumeMl: Number.parseInt(
            volumeText,
            10,
          ),
        },
        sourcePath,
        rawPriceText,
        qualifierEvidence,
      );
    }
  }

  if (normalizedLabel === "bottle") {
    return createOption(
      money,
      "volume",
      {
        variant: "bottle",
      },
      sourcePath,
      rawPriceText,
      qualifierEvidence,
    );
  }

  return createOption(
    money,
    "variant",
    {
      variant: label.trim(),
    },
    sourcePath,
    rawPriceText,
    qualifierEvidence,
  );
}

function parseUnlabelledMoneyParts(
  parts: readonly string[],
  input: ParsePrimaryPriceInput,
): PricingOption[] | null {
  const moneyValues = parts.map(
    (part) => parseMoneyToken(part),
  );

  if (
    moneyValues.some(
      (money) => money === null,
    )
  ) {
    return null;
  }

  const parsedMoney = moneyValues.filter(
    (
      money,
    ): money is ParsedMoney =>
      money !== null,
  );

  if (
    input.sectionPriceOrder !== undefined &&
    input.sectionPriceOrder.length ===
      parsedMoney.length
  ) {
    if (
      input.sectionPriceOrderSourcePath ===
      undefined
    ) {
      throw new Error(
        "sectionPriceOrderSourcePath is required when sectionPriceOrder is used.",
      );
    }

    const options: PricingOption[] = [];

    for (
      let index = 0;
      index < parsedMoney.length;
      index += 1
    ) {
      const money = parsedMoney[index];
      const label =
        input.sectionPriceOrder[index];
      const pricePart = parts[index];

      if (
        money === undefined ||
        label === undefined ||
        pricePart === undefined
      ) {
        throw new Error(
          "Unexpected section price-order indexing error.",
        );
      }

      options.push(
        createOptionFromLabel(
          money,
          label,
          input.sourcePath,
          pricePart,
          {
            source: "section_price_order",
            sourcePath:
              `${input.sectionPriceOrderSourcePath}/${index}`,
            rawText: label,
          },
        ),
      );
    }

    return options;
  }

  const itemNameVariants = input.itemName
    .split("/")
    .map((part) => part.trim())
    .filter(
      (part) => part.length > 0,
    );

  if (
    itemNameVariants.length > 1 &&
    itemNameVariants.length ===
      parsedMoney.length
  ) {
    const options: PricingOption[] = [];

    for (
      let index = 0;
      index < parsedMoney.length;
      index += 1
    ) {
      const money = parsedMoney[index];
      const variant =
        itemNameVariants[index];
      const pricePart = parts[index];

      if (
        money === undefined ||
        variant === undefined ||
        pricePart === undefined
      ) {
        throw new Error(
          "Unexpected item-name variant indexing error.",
        );
      }

      options.push(
        createOption(
          money,
          "variant",
          {
            variant,
          },
          input.sourcePath,
          pricePart,
          {
            source: "item_name",
            sourcePath:
              input.itemNameSourcePath,
            rawText: input.itemName,
          },
        ),
      );
    }

    return options;
  }

  if (input.description !== null) {
    const serviceModeMatch =
      input.description.match(
        /\beat in\s*\/\s*takeaway\b/i,
      );

    if (
      serviceModeMatch !== null &&
      parsedMoney.length === 2
    ) {
      const serviceModes = [
        "eat in",
        "takeaway",
      ] as const;

      const options: PricingOption[] = [];

      for (
        let index = 0;
        index < parsedMoney.length;
        index += 1
      ) {
        const money = parsedMoney[index];
        const serviceMode =
          serviceModes[index];
        const pricePart = parts[index];

        if (
          money === undefined ||
          serviceMode === undefined ||
          pricePart === undefined
        ) {
          throw new Error(
            "Unexpected service-mode indexing error.",
          );
        }

        options.push(
          createOption(
            money,
            "service_mode",
            {
              serviceMode,
            },
            input.sourcePath,
            pricePart,
            {
              source: "item_description",
              sourcePath:
                input.descriptionSourcePath,
              rawText:
                serviceModeMatch[0],
            },
          ),
        );
      }

      return options;
    }

    const waterVariantMatch =
      input.description.match(
        /\bstill\s*\/\s*sparkling\b/i,
      );

    if (
      waterVariantMatch !== null &&
      parsedMoney.length === 2
    ) {
      const variants = [
        "still",
        "sparkling",
      ] as const;

      const options: PricingOption[] = [];

      for (
        let index = 0;
        index < parsedMoney.length;
        index += 1
      ) {
        const money = parsedMoney[index];
        const variant = variants[index];
        const pricePart = parts[index];

        if (
          money === undefined ||
          variant === undefined ||
          pricePart === undefined
        ) {
          throw new Error(
            "Unexpected variant indexing error.",
          );
        }

        options.push(
          createOption(
            money,
            "variant",
            {
              variant,
            },
            input.sourcePath,
            pricePart,
            {
              source: "item_description",
              sourcePath:
                input.descriptionSourcePath,
              rawText:
                waterVariantMatch[0],
            },
          ),
        );
      }

      return options;
    }
  }

  return parsedMoney.map(
    (money, index) => ({
      ...createOption(
        money,
        "unlabelled",
        {
          optionIndex: index + 1,
        },
        input.sourcePath,
        parts[index] ?? "",
      ),
      ambiguity: {
        status: "unresolved",
        reason:
          "The source data provides multiple prices without a supported label mapping.",
      },
    }),
  );
}

export function parsePrimaryPrice(
  input: ParsePrimaryPriceInput,
): Pricing {
  const rawPriceText =
    input.rawPriceText.trim();

  if (rawPriceText.length === 0) {
    throw new Error(
      "Price text must not be empty.",
    );
  }

  const parts = rawPriceText
    .split("/")
    .map((part) => part.trim())
    .filter(
      (part) => part.length > 0,
    );

  const quantityOptions =
    parseQuantityParts(
      parts,
      input.sourcePath,
    );

  if (quantityOptions !== null) {
    return {
      currency: "GBP",
      rawPriceText,
      options: quantityOptions,
    };
  }

  const bundleOptions =
    parseBundleParts(
      parts,
      input.sourcePath,
    );

  if (bundleOptions !== null) {
    return {
      currency: "GBP",
      rawPriceText,
      options: bundleOptions,
    };
  }

  const serviceModeOptions =
    parseServiceModeParts(
      parts,
      input.sourcePath,
    );

  if (serviceModeOptions !== null) {
    return {
      currency: "GBP",
      rawPriceText,
      options: serviceModeOptions,
    };
  }

  const sizeOptions =
    parseSizeParts(
      parts,
      input.sourcePath,
    );

  if (sizeOptions !== null) {
    return {
      currency: "GBP",
      rawPriceText,
      options: sizeOptions,
    };
  }

  if (parts.length > 1) {
    const slashOptions =
      parseUnlabelledMoneyParts(
        parts,
        input,
      );

    if (slashOptions !== null) {
      return {
        currency: "GBP",
        rawPriceText,
        options: slashOptions,
      };
    }
  }

  const singleMoney =
    parseMoneyToken(rawPriceText);

  if (singleMoney !== null) {
    return {
      currency: "GBP",
      rawPriceText,
      options: [
        createOption(
          singleMoney,
          singleMoney.pricingEffect ===
            "surcharge"
            ? "surcharge"
            : "base",
          {},
          input.sourcePath,
          rawPriceText,
        ),
      ],
    };
  }

  throw new Error(
    `Unsupported primary price format: ${rawPriceText}`,
  );
}