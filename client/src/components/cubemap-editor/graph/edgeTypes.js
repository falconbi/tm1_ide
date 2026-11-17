import {
  RuleCalcEdge, RuleFeederEdge, ProcessWriteEdge, ProcessReadEdge,
  ProcessCallEdge, ProcessDimWriteEdge, DimUsedByEdge,
} from './edges'

export const edgeTypes = { rule_calc: RuleCalcEdge, rule_feeder: RuleFeederEdge, process_write: ProcessWriteEdge, process_read: ProcessReadEdge, process_call: ProcessCallEdge, process_dimwrite: ProcessDimWriteEdge, dim_used_by: DimUsedByEdge }
export const PROCESS_EDGE_TYPES = new Set(['process_write', 'process_read', 'process_call', 'process_dimwrite', 'dim_used_by'])
