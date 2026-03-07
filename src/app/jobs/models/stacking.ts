import { TypeGuard } from 'src/app/utils/guard-type.pipe';
import { Job } from './job';
import { JobBase, JobResultBase } from './job-base';
import { JobResult } from './job-result';
import { JobType } from './job-types';
import { SourceExtractionData } from './source-extraction';

export interface StackSettings {
  mode: 'average' | 'percentile' | 'mode' | 'sum';
  scaling: null | 'average' | 'median' | 'mode' | 'histogram';
  prescaling: null | 'average' | 'median' | 'mode' | 'histogram';
  rejection: null | 'chauvenet' | 'iraf' | 'minmax' | 'sigclip' | 'rcr';
  percentile?: number;
  smartStacking: 'none' | 'SNR' | 'sharpness'
  lo?: number;
  hi?: number;
  nuCol?: number;
  propagateMask: boolean;
  equalizeAdditive: boolean;
  equalizeOrder: number;
  equalizeMultiplicative: boolean;
  multiplicativePercentile: number;
  equalizeGlobal: boolean;
}

export interface StackingJobResult extends JobResultBase {
  readonly type: JobType.Stacking;
  fileId: string;
}

export interface StackingJob extends JobBase {
  readonly type: JobType.Stacking;
  fileIds: string[];
  stackingSettings?: StackSettings;
  result?: StackingJobResult;
}

export const isStackingJob: TypeGuard<Job, StackingJob> = (
  job: Job
): job is StackingJob => job.type === JobType.Stacking;

export const isStackingJobResult: TypeGuard<JobResult, StackingJobResult> = (
  result: JobResult
): result is StackingJobResult => result.type === JobType.Stacking;
