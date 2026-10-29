"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { RESTAURANT_NAME_MAX_LENGTH, TAX_REGIME_PRESETS, TAX_REGIMES, type TaxRegime } from "@nodedr-restaurant/types";
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogout } from "@/hooks/use-auth";
import { api, ApiError } from "@/lib/api";
import { restaurantSetupSchema, type RestaurantSetupDto } from "@/lib/onboarding";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

const selectClass = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SetupScreen({ initialValues }: { initialValues?: RestaurantSetupDto }) {
  const logout = useLogout();
  const [error, setError] = useState<string | null>(null);
  const setup = useMutation({
    mutationFn: (values: RestaurantSetupDto) => api.post("/auth/setup", values),
    // A fresh server request decides the destination from the committed data.
    onSuccess: () => window.location.replace("/"),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not reach the server. Please try again."),
  });
  const { control, register, handleSubmit, setValue, formState: { errors } } = useForm<RestaurantSetupDto>({
    resolver: zodResolver(restaurantSetupSchema),
    defaultValues: initialValues,
  });
  const regime = useWatch({ control, name: "taxRegime" }) ?? "INDIA_GST";
  const regimeField = register("taxRegime");

  return (
    <main className="flex flex-1 justify-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-3xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo size={38} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Nodedr OrderRestro</p>
              <h1 className="text-2xl font-semibold tracking-tight">Restaurant setup</h1>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={logout.isPending || setup.isPending}
            onClick={() => logout.mutate(undefined, { onSuccess: () => window.location.replace("/login") })}
          >
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </header>

        {!initialValues ? (
          <Card className="gap-3 p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Setup access required</h2>
            <p className="text-sm text-muted-foreground">
              Your account is not authorized to create or configure this restaurant. Ask the restaurant owner or an administrator for access.
            </p>
          </Card>
        ) : (
          <form onSubmit={handleSubmit((values) => { setError(null); setup.mutate(values); })} className="space-y-5">
            <Card className="gap-5 p-6 sm:p-8">
              <div>
                <h2 className="text-lg font-semibold">Your restaurant</h2>
                <p className="mt-1 text-sm text-muted-foreground">These details can be changed later in Settings.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="restaurantName" label="Restaurant name" error={errors.restaurantName?.message}>
                  <Input id="restaurantName" className="h-10" autoComplete="organization" maxLength={RESTAURANT_NAME_MAX_LENGTH} required {...register("restaurantName")} />
                </Field>
                <Field id="branchName" label="First branch name" error={errors.branchName?.message}>
                  <Input id="branchName" className="h-10" maxLength={100} required {...register("branchName")} />
                </Field>
                <Field id="address" label="Branch address (optional)" error={errors.address?.message}>
                  <Input id="address" className="h-10" autoComplete="street-address" maxLength={500} {...register("address")} />
                </Field>
                <Field id="phone" label="Branch phone (optional)" error={errors.phone?.message}>
                  <Input id="phone" className="h-10" type="tel" autoComplete="tel" maxLength={40} {...register("phone")} />
                </Field>
                <Field id="currency" label="Currency code" error={errors.currency?.message}>
                  <Input id="currency" className="h-10 uppercase" placeholder="INR" maxLength={3} required {...register("currency")} />
                </Field>
                <Field id="timezone" label="Timezone" error={errors.timezone?.message}>
                  <Input id="timezone" className="h-10" placeholder="Asia/Kolkata" maxLength={100} required {...register("timezone")} />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">Use an ISO currency code and an IANA timezone, for example INR and Asia/Kolkata.</p>
            </Card>

            <Card className="gap-5 p-6 sm:p-8">
              <div>
                <h2 className="text-lg font-semibold">Branch tax settings</h2>
                <p className="mt-1 text-sm text-muted-foreground">Choose how menu prices and receipts handle tax. Set the applicable tax rate on each menu item later.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="taxRegime" label="Region / tax regime" error={errors.taxRegime?.message}>
                  <select
                    id="taxRegime"
                    className={selectClass}
                    {...regimeField}
                    onChange={(event) => {
                      void regimeField.onChange(event);
                      const selected = event.target.value as TaxRegime;
                      setValue("country", TAX_REGIME_PRESETS[selected].defaultCountry);
                      setValue("taxMode", TAX_REGIME_PRESETS[selected].defaultMode);
                    }}
                  >
                    {TAX_REGIMES.map((value) => <option key={value} value={value}>{TAX_REGIME_PRESETS[value].displayName}</option>)}
                  </select>
                </Field>
                <Field id="taxMode" label="Menu prices are" error={errors.taxMode?.message}>
                  <select id="taxMode" className={selectClass} {...register("taxMode")}>
                    <option value="INCLUSIVE">Tax-inclusive</option>
                    <option value="EXCLUSIVE">Tax-exclusive (added at checkout)</option>
                  </select>
                </Field>
                <Field id="country" label="Country code" error={errors.country?.message}>
                  <Input id="country" className="h-10 uppercase" placeholder="IN" maxLength={2} required {...register("country")} />
                </Field>
                <Field id="taxId" label={`${TAX_REGIME_PRESETS[regime].taxIdLabel} (optional)`} error={errors.taxId?.message}>
                  <Input id="taxId" className="h-10" maxLength={50} {...register("taxId")} />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">{TAX_REGIME_PRESETS[regime].exampleRates}</p>
            </Card>

            {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">You can review these settings at any time.</p>
              <Button type="submit" className="h-11 px-6" disabled={setup.isPending || logout.isPending}>
                {setup.isPending ? "Saving restaurant…" : "Complete setup"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
