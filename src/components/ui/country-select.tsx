"use client";

import { useEffect, useState } from "react";
import ReactSelect, { type SingleValue } from "react-select";
import { countryOptions } from "@/lib/constants";

interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function CountrySelect({ value, onChange }: CountrySelectProps) {
  const [mounted, setMounted] = useState(false);
  const selected = countryOptions.find((c) => c.value === value) || null;

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-10 w-full items-center rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground">
        {selected ? selected.label : "Select your country"}
      </div>
    );
  }

  return (
    <ReactSelect
      instanceId="country-select"
      options={countryOptions}
      value={selected}
      onChange={(option: SingleValue<{ value: string; label: string }>) =>
        onChange(option?.value || "")
      }
      isSearchable
      placeholder="Select your country"
      className="react-select-container"
      classNamePrefix="react-select"
      styles={{
        control: (base) => ({
          ...base,
          height: "2.5rem",
          minHeight: "2.5rem",
          borderRadius: "0.5rem",
          borderColor: "hsl(var(--input))",
          backgroundColor: "hsl(var(--background))",
          fontSize: "0.875rem",
          boxShadow: "none",
          "&:hover": { borderColor: "hsl(var(--input))" },
        }),
        menu: (base) => ({
          ...base,
          backgroundColor: "hsl(var(--popover))",
          borderRadius: "0.5rem",
          border: "1px solid hsl(var(--border))",
          zIndex: 9999,
        }),
        option: (base, state) => ({
          ...base,
          backgroundColor: state.isSelected
            ? "hsl(var(--primary))"
            : state.isFocused
            ? "hsl(var(--accent))"
            : "hsl(var(--popover))",
          color: state.isSelected ? "hsl(var(--primary-foreground))" : "hsl(var(--popover-foreground))",
          fontSize: "0.875rem",
          cursor: "pointer",
        }),
        singleValue: (base) => ({
          ...base,
          color: "hsl(var(--foreground))",
        }),
        input: (base) => ({
          ...base,
          color: "hsl(var(--foreground))",
        }),
        placeholder: (base) => ({
          ...base,
          color: "hsl(var(--muted-foreground))",
          fontSize: "0.875rem",
        }),
      }}
    />
  );
}
