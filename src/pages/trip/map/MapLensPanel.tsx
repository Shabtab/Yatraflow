// One deck for the active Map lens. The panel renders exactly one deck and
// passes every deck callback through as a prop. It reads no store, no map and
// no provider.
import type { ReactNode } from 'react'
import { DriveTabs } from '../../../components/map/lenses/DriveTabs'
import { FixDeck } from '../../../components/map/lenses/FixDeck'
import { GapDeck } from '../../../components/map/lenses/GapDeck'
import { LensDeckHeader } from '../../../components/map/lenses/LensDeckHeader'
import { StayDeck, type RingId } from '../../../components/map/lenses/StayDeck'
import type { DriveCardStrip, DriveTab, ScopeBand } from './driveLens'
import type { DriveLensRow, FixChangeSet } from '../../../lib/mapLensContracts'
import type { PlaceHit } from '../../../lib/geocode'
import type { GapPick } from './gapLens'
import type { StayPick } from './stayLens'
import type { MapLensId, MapLenses } from './useMapLenses'

type DriveRow = DriveLensRow

export interface MapLensPanelProps {
  routeAdvice?: ReactNode
  lens: MapLensId
  lenses: MapLenses
  dayLabel: string
  dayNumber: number
  clock: (min: number) => string
  activeDriveTab: DriveTab | null
  onDriveTab: (tab: DriveTab) => void
  /** The one pick-letter map for the map pins, cards and peek. */
  driveLetters?: Record<string, 'A' | 'B' | 'C'>
  stripOf: (row: DriveRow) => DriveCardStrip
  bandOf: (row: DriveRow) => ScopeBand
  introOf: (row: DriveRow) => string | null
  /** The live scope, in minutes there and back. A non-window deck names it. */
  scopeMinutes?: number | null
  /** The Drive scope picker and count. It sits in the deck title row. */
  scopeSlot?: ReactNode
  onOpenDrive: (row: DriveRow) => void
  onAddDrive: (row: DriveRow) => void
  activeStayWindow: string | null
  onStayWindow: (id: string) => void
  stayRing: RingId
  onStayRing: (id: RingId) => void
  onOpenStayPick: (pick: StayPick) => void
  onAddStayPick: (pick: StayPick, startMin: number | null) => void
  onSetStay: () => void
  onOpenGapPick: (pick: GapPick) => void
  onAddGapPick: (pick: GapPick) => void
  /** Day actions for the Gap deck header. */
  gapAside?: ReactNode
  /** The Gap part opened from the day list. */
  gapActiveIndex?: number | null
  onApplyFix: (set: FixChangeSet) => void
  onPreviewFix: (set: FixChangeSet) => void
  /** The Keep action of the deck cards. Absent hides the heart. */
  onShortlist?: (hit: PlaceHit) => void
  /** True draws the kept heart on a card. */
  shortlistedOf?: (hit: PlaceHit) => boolean
  /** The swap action of a pick. Null means the pick has no planned stop to replace. */
  swapOf?: (hit: PlaceHit) => (() => void) | null
  /** The deck fold handler. Absent uses the Map tab fold button. */
  onFold?: () => void
  /** The scan retry of the Drive, Stay and Gap decks. Absent draws no Retry button. */
  onRetry?: () => void
}

/** The stay deck when the base exists but no free window is known. */
function StayWindowUnknown({ onClose, noFreeTime }: { onClose?: () => void; noFreeTime?: boolean }) {
  return <section className="mv2-lens-deck" aria-label="Around the stay">
    <LensDeckHeader kicker="Around the stay" title="Around the stay" onClose={onClose} />
    <p className="mv2-lens-phase">{noFreeTime === true
      ? 'Stay · No free time'
      : 'Stay free time · Not measured'}</p>
  </section>
}

export function MapLensPanel(props: MapLensPanelProps) {
  const { lens, lenses } = props
  if (lens === 'drive') {
    const groups = lenses.drive.tabs.tabs
    const active = groups.find(group => group.tab === props.activeDriveTab) ?? groups[0]
    const intro = active?.shown[0] ? props.introOf(active.shown[0]) : null
    // A deck with no window has no pass line. It still states the real scope.
    return <DriveTabs
      scopeSlot={props.scopeSlot}
      result={lenses.drive.tabs}
      activeTab={props.activeDriveTab}
      onTab={props.onDriveTab}
      intro={intro}
      stripOf={props.stripOf}
      bandOf={props.bandOf}
      nameOf={row => row.row.hit.name}
      onOpen={props.onOpenDrive}
      onAdd={props.onAddDrive}
      dayNumber={props.dayNumber}
      reasonOf={row => row.row.reason}
      {...(props.driveLetters == null ? {} : { letters: props.driveLetters })}
      {...(props.onShortlist == null ? {} : { onShortlist: props.onShortlist })}
      {...(props.shortlistedOf == null ? {} : { shortlistedOf: props.shortlistedOf })}
      {...(props.swapOf == null ? {} : { swapOf: props.swapOf })}
      onClose={props.onFold}
      {...(props.onRetry == null ? {} : { onRetry: props.onRetry })}
    />
  }
  if (lens === 'stay') {
    const stay = lenses.stay
    if (stay.needsBase || stay.base == null) {
      return <StayDeck
        dayNumber={props.dayNumber}
        dayLabel={props.dayLabel}
        baseName={null}
        windows={[]}
        activeWindowId={null}
        onWindow={props.onStayWindow}
        result={{ kind: 'needs-base' }}
        ringId={props.stayRing}
        onRing={props.onStayRing}
        onOpenPick={props.onOpenStayPick}
        onAddPick={props.onAddStayPick}
        {...(props.onShortlist == null ? {} : { onShortlist: props.onShortlist })}
        {...(props.shortlistedOf == null ? {} : { shortlistedOf: props.shortlistedOf })}
        onSetStay={props.onSetStay}
        clock={props.clock}
        onClose={props.onFold}
      />
    }
    if (stay.windowUnknown) return <StayWindowUnknown onClose={props.onFold} noFreeTime={stay.noFreeTime === true} />
    const activeWindow = stay.windows.find(window => window.id === props.activeStayWindow)
      ?? stay.windows[0]
    const result = activeWindow == null
      ? { kind: 'phase' as const, phase: stay.phase === 'needs-base' ? 'empty' as const : stay.phase }
      : stay.picks[activeWindow.id] ?? { kind: 'phase' as const, phase: stay.phase === 'needs-base' ? 'empty' as const : stay.phase }
    return <StayDeck
      dayNumber={props.dayNumber}
      dayLabel={props.dayLabel}
      baseName={stay.base.name}
      windows={stay.windows}
      activeWindowId={activeWindow?.id ?? null}
      onWindow={props.onStayWindow}
      result={result}
      ringId={props.stayRing}
      onRing={props.onStayRing}
      onOpenPick={props.onOpenStayPick}
      onAddPick={props.onAddStayPick}
      {...(props.onShortlist == null ? {} : { onShortlist: props.onShortlist })}
      {...(props.shortlistedOf == null ? {} : { shortlistedOf: props.shortlistedOf })}
      onSetStay={props.onSetStay}
      clock={props.clock}
      {...(props.swapOf == null ? {} : { swapOf: props.swapOf })}
      onClose={props.onFold}
      {...(props.onRetry == null ? {} : { onRetry: props.onRetry })}
    />
  }
  if (lens === 'gap') {
    return <GapDeck
      dayNumber={props.dayNumber}
      phase={lenses.gap.phase}
      gaps={lenses.gap.gaps}
      onOpenPick={props.onOpenGapPick}
      onAddPick={props.onAddGapPick}
      aside={props.gapAside}
      activeIndex={props.gapActiveIndex ?? null}
      {...(props.onShortlist == null ? {} : { onShortlist: props.onShortlist })}
      {...(props.shortlistedOf == null ? {} : { shortlistedOf: props.shortlistedOf })}
      clock={props.clock}
      {...(props.swapOf == null ? {} : { swapOf: props.swapOf })}
      onClose={props.onFold}
      {...(props.onRetry == null ? {} : { onRetry: props.onRetry })}
    />
  }
  return <FixDeck routeAdvice={props.routeAdvice}
    phase={lenses.fix.phase}
    dayNumber={props.dayNumber}
    problem={lenses.fix.problem}
    fixes={lenses.fix.fixes}
    onApply={props.onApplyFix}
    onPreview={props.onPreviewFix}
    onClose={props.onFold}
  />
}
