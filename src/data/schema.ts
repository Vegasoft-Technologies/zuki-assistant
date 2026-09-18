import { z } from "zod";

const nonEmptyStringSchema = z.string().min(1);

const openingHoursEntrySchema = z
  .object({
    open: nonEmptyStringSchema,
    close: nonEmptyStringSchema,
  })
  .passthrough();

const menuItemSchema = z
  .object({
    name: nonEmptyStringSchema,
    price: nonEmptyStringSchema,
    dietary: z.array(nonEmptyStringSchema),
    description: z.string().nullable(),
    options: z.array(nonEmptyStringSchema).optional(),
  })
  .passthrough();

const menuSectionSchema = z
  .object({
    section: nonEmptyStringSchema,
    items: z.array(menuItemSchema),

    extras: z
      .record(z.string(), nonEmptyStringSchema)
      .optional(),

    pricing: z
      .record(z.string(), nonEmptyStringSchema)
      .optional(),

    price_order: z.array(nonEmptyStringSchema).optional(),

    mini_bottles: z
      .record(z.string(), nonEmptyStringSchema)
      .optional(),

    note: nonEmptyStringSchema.optional(),
    site_heading: nonEmptyStringSchema.optional(),
  })
  .passthrough();

const businessFactProvenanceSchema = z
  .object({
    status: z.enum([
      "verified",
      "verified_third_party",
      "verified_business_managed_listing",
    ]),
    sources: z
      .array(
        z
          .string()
          .url()
          .refine(
            (value) => /^https?:\/\//iu.test(value),
            "source must use http or https",
          ),
      )
      .min(1),
    verified_on: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        "verified_on must use YYYY-MM-DD format",
      )
      .refine(
        (value) => {
          const date =
            new Date(
              `${value}T00:00:00Z`,
            );

          return (
            !Number.isNaN(
              date.getTime(),
            ) &&
            date
              .toISOString()
              .slice(0, 10) === value
          );
        },
        "verified_on must be a valid calendar date",
      ),
  })
  .passthrough();

const businessFactsSchema = z
  .object({
    dog_policy: nonEmptyStringSchema.optional(),
    parking: nonEmptyStringSchema.optional(),
    card_payments: nonEmptyStringSchema.optional(),
    provenance: z
      .object({
        dog_policy:
          businessFactProvenanceSchema.optional(),
        parking:
          businessFactProvenanceSchema.optional(),
        card_payments:
          businessFactProvenanceSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const zukiDataSchema = z
  .object({
    business: z
      .object({
        name: nonEmptyStringSchema,
        website: nonEmptyStringSchema,
        address: nonEmptyStringSchema,
        phone: nonEmptyStringSchema,
        currency: nonEmptyStringSchema,
      })
      .passthrough(),

    opening_hours: z
      .object({
        monday: openingHoursEntrySchema,
        tuesday: openingHoursEntrySchema,
        wednesday: openingHoursEntrySchema,
        thursday: openingHoursEntrySchema,
        friday: openingHoursEntrySchema,
        saturday: openingHoursEntrySchema,
        sunday: openingHoursEntrySchema,
      })
      .passthrough(),

    menu_service: z
      .object({
        full_menu_until: nonEmptyStringSchema,
        brunch_mimosa_add_on: nonEmptyStringSchema,
        site_text: nonEmptyStringSchema,
      })
      .passthrough(),

    menu: z.array(menuSectionSchema),

    source: z
      .object({
        url: nonEmptyStringSchema,
        verified_on: z
          .string()
          .regex(
            /^\d{4}-\d{2}-\d{2}$/,
            "source.verified_on must use YYYY-MM-DD format",
          ),
      })
      .passthrough(),

    dietary_legend: z.record(z.string(), nonEmptyStringSchema),

    customer_notes: z.record(z.string(), nonEmptyStringSchema),

    business_facts:
      businessFactsSchema.optional(),
  })
  .passthrough();

export type SourceMenuItem = z.infer<typeof menuItemSchema>;
export type SourceMenuSection = z.infer<typeof menuSectionSchema>;
export type SourceZukiData = z.infer<typeof zukiDataSchema>;