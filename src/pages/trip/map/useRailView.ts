// #420 slice 12: the rail view — how the map and the rails are looked at.
//
// The reason chip, the fold spines, the map's day report, the rail's own day,
// the narrow-band sheet and the return-line toggle move together. All of them
// are display state: nothing here writes the trip. The hook returns the states
// with their plain React setters — the page calls those from event handlers
// only, never during render — plus the one rule that reads them.
import { useEffect, useState } from 'react'
import { sheetAppliesAt, type SheetTabKey } from '../../../lib/mapSheet'
import { resolveRailDay } from '../../../lib/tripFocus'

export type RailViewArgs = {
  dayFocus: number | 'all' | undefined
  dayIndexes: number[]
}

export function useRailView({ dayFocus, dayIndexes }: RailViewArgs) {
  // One reason chip can narrow the rail, so "where are the lunch options?" is a
  // tap instead of a scroll.
  const [chipFilter, setChipFilter] = useState<string | null>(null)
  // Fold-to-spines: either rail can step back to a 48px spine so the map gains
  // the room. Session state on purpose - a layout whim should not persist.
  const [folded, setFolded] = useState<{ needs: boolean; see: boolean }>({ needs: false, see: false })
  // P2: the day the plan rail reads. Day 1 by default; the strip's chips switch it.
  // #416: what the map is showing, as far as the rail has been TOLD.
  // null = not reported yet, which must stay silent rather than guess.
  const [mapFilter, setMapFilter] = useState<number | 'all' | null>(null)
  const [localDay, setLocalDay] = useState(0)
  const activeDayIndex = resolveRailDay(dayFocus, dayIndexes, localDay)
  // #415: which rail the narrow-band sheet shows, and whether the sheet is in play
  // at all. false until the width is measured -- the desktop layout is what renders
  // on an unknown width, never a guess that hides a rail.
  const [sheetTab, setSheetTab] = useState<SheetTabKey>('needs')
  const [sheetApplies, setSheetApplies] = useState(false)
  useEffect(() => {
    const sync = () => setSheetApplies(sheetAppliesAt(typeof window === 'undefined' ? null : window.innerWidth))
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  // #polylines: the Return-home toggle is a DIRECTION filter, not a drawing
  // switch. On (default): the corridor reads the loop — km labels wrap past the
  // far end onto the ride home, exactly like the plan's loop math. Off: the
  // outbound road only — a place 30 km before the far end reads ~30 km from
  // home on the way back instead of a meaningless 95% of the loop.
  const [showReturn, setShowReturn] = useState(true)

  return {
    chipFilter, setChipFilter, folded, setFolded, mapFilter, setMapFilter,
    localDay, setLocalDay, activeDayIndex, sheetTab, setSheetTab, sheetApplies,
    showReturn, setShowReturn,
  }
}
