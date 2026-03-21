'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { FilterType } from '@/constants/types'

interface MarketplaceFiltersProps {
  activeFilter: FilterType
  onFilterChange: (filter: FilterType) => void
  isConnected: boolean
}

export function MarketplaceFilters({ 
  activeFilter, 
  onFilterChange,
  isConnected 
}: MarketplaceFiltersProps) {
  return (
    <Tabs value={activeFilter} onValueChange={(v) => onFilterChange(v as FilterType)}>
      <TabsList className="bg-secondary/50">
        <TabsTrigger value="all" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
          Todas
        </TabsTrigger>
        <TabsTrigger 
          value="open" 
          className="data-[state=active]:bg-emerald data-[state=active]:text-black"
        >
          Abiertas
        </TabsTrigger>
        <TabsTrigger 
          value="my-bets" 
          disabled={!isConnected}
          className="data-[state=active]:bg-violet data-[state=active]:text-white disabled:opacity-50"
        >
          Mis Apuestas
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
