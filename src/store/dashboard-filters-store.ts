"use client";

import { create } from "zustand";
import type { Dhis2FilterState } from "@/types";

interface DashboardFiltersState {
  filter: Dhis2FilterState;
  setFilter: (filter: Dhis2FilterState) => void;
  updateFilter: (partial: Partial<Dhis2FilterState>) => void;
  resetFilters: () => void;
  /** Reset geography and period but keep the antigen of the coverage page. */
  resetScope: () => void;
}

const DEFAULT_FILTER: Dhis2FilterState = {
  orgUnitId: "ymGeqzoPhN3",
  orgUnitLevel: 1,
  orgUnitPath: [],
  dataSetId: null,
  periodPreset: "LAST_12_MONTHS",
  antigeId: "v9b9aYsA5PM", // Penta3 par défaut
};

export const useDashboardFilters = create<DashboardFiltersState>((set) => ({
  filter: DEFAULT_FILTER,
  setFilter: (filter) => set({ filter }),
  updateFilter: (partial) =>
    set((state) => ({ filter: { ...state.filter, ...partial } })),
  resetFilters: () => set({ filter: DEFAULT_FILTER }),
  resetScope: () => set((state) => ({ filter: { ...DEFAULT_FILTER, antigeId: state.filter.antigeId } })),
}));
