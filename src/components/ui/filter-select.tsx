"use client";

import { useState } from "react";
import ReactSelect, { type SingleValue } from "react-select";

interface FilterSelectOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  options: FilterSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
  isLoading?: boolean;
  minWidth?: number;
  className?: string;
}

export function FilterSelect({
  options,
  value,
  onChange,
  placeholder = "Sélectionner…",
  isDisabled = false,
  isLoading = false,
  minWidth = 160,
  className,
}: FilterSelectProps) {
  const [mounted, setMounted] = useState(false);
  const selected = options.find((o) => o.value === value) || null;

  if (!mounted) {
    setMounted(true);
  }

  if (!mounted) {
    return (
      <div
        className={`flex h-11 items-center rounded-xl border border-input bg-background px-3 text-[15px] text-muted-foreground ${className ?? ""}`}
        style={{ minWidth }}
      >
        {selected ? selected.label : placeholder}
      </div>
    );
  }

  return (
    <div className={className}>
    <ReactSelect
      instanceId={`filter-select-${placeholder}`}
      options={options}
      value={selected}
      onChange={(option: SingleValue<FilterSelectOption>) =>
        onChange(option?.value || "")
      }
      isSearchable
      isDisabled={isDisabled}
      isLoading={isLoading}
      placeholder={placeholder}
      className="react-select-container"
      classNamePrefix="react-select"
      styles={{
        control: (base) => ({
          ...base,
          height: "2.75rem",
          minHeight: "2.75rem",
          width: "100%",
          minWidth,
          borderRadius: "0.75rem",
          borderColor: "hsl(var(--input))",
          backgroundColor: "hsl(var(--background))",
          fontSize: "0.9375rem",
          boxShadow: "none",
          cursor: "pointer",
          "&:hover": { borderColor: "hsl(var(--input))" },
        }),
        menu: (base) => ({
          ...base,
          backgroundColor: "hsl(var(--popover))",
          borderRadius: "0.75rem",
          border: "1px solid hsl(var(--border))",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
          zIndex: 9999,
          maxHeight: "240px",
        }),
        menuList: (base) => ({
          ...base,
          maxHeight: "240px",
          padding: "4px",
        }),
        option: (base, state) => ({
          ...base,
          backgroundColor: state.isSelected
            ? "hsl(var(--primary))"
            : state.isFocused
            ? "hsl(var(--accent))"
            : "hsl(var(--popover))",
          color: state.isSelected
            ? "hsl(var(--primary-foreground))"
            : "hsl(var(--popover-foreground))",
          fontSize: "0.9375rem",
          borderRadius: "0.375rem",
          padding: "8px 12px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }),
        singleValue: (base) => ({
          ...base,
          color: "hsl(var(--foreground))",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }),
        input: (base) => ({
          ...base,
          color: "hsl(var(--foreground))",
        }),
        placeholder: (base) => ({
          ...base,
          color: "hsl(var(--muted-foreground))",
          fontSize: "0.9375rem",
        }),
        indicatorSeparator: (base) => ({
          ...base,
          backgroundColor: "hsl(var(--border))",
        }),
        dropdownIndicator: (base) => ({
          ...base,
          color: "hsl(var(--muted-foreground))",
          padding: "4px",
          "&:hover": { color: "hsl(var(--foreground))" },
        }),
      }}
    />
    </div>
  );
}
