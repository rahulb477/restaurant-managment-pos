import { RESTAURANT_NAME_MAX_LENGTH, TAX_MODES, TAX_REGIMES } from "@nodedr-restaurant/types";
import { z } from "zod";

// This is the Firebase web signup DTO. The legacy Nest registration DTO still
// includes restaurant/branch names and is intentionally left unchanged.
export const signupSchema = z.object({
  ownerName: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().email("Enter a valid email address").max(254),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});
export type SignupDto = z.infer<typeof signupSchema>;

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Address, phone and tax ID are optional in the existing Branch model. Tax
// rates are per menu item, not a restaurant-wide setting.
export const restaurantSetupSchema = z.strictObject({
  restaurantName: z.string().trim().min(1, "Enter a restaurant name").max(RESTAURANT_NAME_MAX_LENGTH),
  branchName: z.string().trim().min(1, "Enter a branch name").max(100),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(40)
    .refine((value) => !value || /^(?=.*\d)[+\d()\-.\s#xext]{3,40}$/i.test(value), "Enter a valid phone number")
    .optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code")
    .refine((value) => Intl.supportedValuesOf("currency").includes(value), "Enter a valid currency code"),
  timezone: z.string().trim().min(1, "Enter a timezone").max(100)
    .refine(isTimeZone, "Enter a valid IANA timezone, e.g. Asia/Kolkata"),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code"),
  taxRegime: z.enum(TAX_REGIMES),
  taxMode: z.enum(TAX_MODES),
  taxId: z.string().trim().max(50).optional(),
});
export type RestaurantSetupDto = z.infer<typeof restaurantSetupSchema>;

export type SetupStatus = "ready" | "needs_setup" | "forbidden";
export type SetupAccess = { status: SetupStatus; canSetup: boolean };
export type AuthDestination = "/login" | "/setup" | "/dashboard";

// A forbidden account also goes to /setup, where it sees an access-denied
// message instead of the form. This avoids looping between guarded routes.
export function destinationFor(access: SetupAccess | null): AuthDestination {
  if (!access) return "/login";
  return access.status === "ready" ? "/dashboard" : "/setup";
}
