import type { Role } from '../../engine/types.ts'
import { ROLE_OBJECTIVE_MODEL_VERSION } from './role-objective-types.ts'
import {
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  type RoutedRoleObjectiveModel,
} from './evil-objective-types.ts'

/** Pure, explicit routing. It never enables policy or changes legacy C1 opt-in. */
export function routedRoleObjectiveModel(role: Role): RoutedRoleObjectiveModel {
  if (role === 'merlin' || role === 'percival') {
    return ROLE_OBJECTIVE_MODEL_VERSION
  }
  if (
    role === 'assassin'
    || role === 'morgana'
    || role === 'mordred'
    || role === 'minion'
    || role === 'oberon'
  ) {
    return EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  }
  return 'off'
}
