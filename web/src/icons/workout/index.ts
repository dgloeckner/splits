import type { ComponentType } from 'react'
import { IconJustRow } from './IconJustRow'
import { IconDistance } from './IconDistance'
import { IconTime } from './IconTime'
import { IconInterval } from './IconInterval'
import { IconPyramid } from './IconPyramid'
import { IconRace } from './IconRace'

export { IconJustRow, IconDistance, IconTime, IconInterval, IconPyramid, IconRace }

export type WorkoutIconKind = 'just_row' | 'distance' | 'time' | 'intervals' | 'pyramid' | 'race'

type IconProps = { size?: number; className?: string }

const MAP: Record<WorkoutIconKind, ComponentType<IconProps>> = {
  just_row: IconJustRow,
  distance: IconDistance,
  time: IconTime,
  intervals: IconInterval,
  pyramid: IconPyramid,
  race: IconRace,
}

export function workoutIconFor(kind: WorkoutIconKind | string | undefined): ComponentType<IconProps> {
  return MAP[(kind ?? 'just_row') as WorkoutIconKind] ?? IconJustRow
}
