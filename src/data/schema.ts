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
  })
  .passthrough();

export type SourceMenuItem = z.infer<typeof menuItemSchema>;
export type SourceMenuSection = z.infer<typeof menuSectionSchema>;
export type SourceZukiData = z.infer<typeof zukiDataSchema>;