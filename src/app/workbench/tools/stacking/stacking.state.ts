import {
    State,
    Action,
    Actions,
    Selector,
    StateContext,
    ofActionDispatched,
    ofActionCompleted,
    ofActionSuccessful,
    ofActionErrored,
    createSelector,
    Store,
} from '@ngxs/store';
import { ImmutableSelector, ImmutableContext } from '@ngxs-labs/immer-adapter';
import { tap, catchError, finalize, filter, take, takeUntil, map, flatMap, skip, delay } from 'rxjs/operators';
import { of, merge, interval, Observable } from 'rxjs';
import { Injectable } from '@angular/core';
import { JobsState } from 'src/app/jobs/jobs.state';
import { Job } from 'src/app/jobs/models/job';
import { DataFilesState } from 'src/app/data-files/data-files.state';
import { JobType } from 'src/app/jobs/models/job-types';
import { JobService } from 'src/app/jobs/services/job.service';
import { CloseLayerSuccess, InvalidateHeader, InvalidateRawImageTiles, LoadLibrary } from 'src/app/data-files/data-files.actions';
import { getLongestCommonStartingSubstring, isNotEmpty } from 'src/app/utils/utils';
import { StackFormData } from './models/stacking-form-data';
import { isStackingJob, StackingJob } from 'src/app/jobs/models/stacking';
import { CreateStackingJob, SetCurrentJobId, UpdateFormData } from './stacking.actions';
import { AfterglowDataFileService } from '../../services/afterglow-data-files';



export interface StackingStateModel {
    version: string;
    formData: StackFormData;
    currentJobId: string;
}

const stackingDefaultState: StackingStateModel = {
    version: 'f24d45d4-5194-4406-be15-511911c5aaf5',
    formData: {
        selectedLayerIds: [],
        propagateMask: false,
        mode: 'average',
        scaling: 'none',
        rejection: 'none',
        smartStacking: 'none',
        percentile: 50,
        low: 0,
        high: 0,
        nuCol: 0,
        equalizeAdditive: false,
        equalizeOrder: 0,
        equalizeMultiplicative: false,
        multiplicativePercentile: 99.9,
        equalizeGlobal: false
    },
    currentJobId: null
};

@State<StackingStateModel>({
    name: 'stacking',
    defaults: stackingDefaultState,
})
@Injectable()
export class StackingState {
    constructor(private actions$: Actions, private store: Store, private jobService: JobService, private dataFileService: AfterglowDataFileService) { }

    @Selector()
    public static getState(state: StackingStateModel) {
        return state;
    }

    @Selector()
    public static getFormData(state: StackingStateModel) {
        return state.formData;
    }

    @Selector()
    public static getCurrentJobId(state: StackingStateModel) {
        return state.currentJobId;
    }

    @Selector([StackingState.getCurrentJobId, JobsState.getJobEntities])
    public static getCurrentJob(jobId: string, jobEntities: { [id: string]: Job }) {
        let job = jobEntities[jobId];
        if (!job || !isStackingJob(job)) return null;
        return job;
    }


    @Action(UpdateFormData)
    public updateFormData({ getState, setState, dispatch }: StateContext<StackingStateModel>, { changes }: UpdateFormData) {
        setState((state: StackingStateModel) => {
            return {
                ...state,
                formData: {
                    ...state.formData,
                    ...changes
                }
            };
        });
    }



    @Action(SetCurrentJobId)
    public setCurrentJobId({ getState, setState, dispatch }: StateContext<StackingStateModel>, { jobId }: SetCurrentJobId) {
        setState((state: StackingStateModel) => {
            return {
                ...state,
                jobId: jobId
            };
        });
    }

    @Action(CreateStackingJob)
    @ImmutableContext()
    public createStackingJob(
        { getState, setState, dispatch }: StateContext<StackingStateModel>,
        { layerIds, settings, outFilename }: CreateStackingJob
    ) {
        let job: StackingJob = {
            type: JobType.Stacking,
            id: null,
            fileIds: layerIds,
            stackingSettings: settings,
            state: null,
        };

        let job$ = this.jobService.createJob(job);

        job$.pipe(
            takeUntil(this.actions$.pipe(ofActionDispatched(CreateStackingJob))),
            take(1)
        ).subscribe(job => {
            if (job.id) {
                setState((state: StackingStateModel) => {
                    state.currentJobId = job.id;
                    return state;
                });
            }
        })

        job$.subscribe(job => {
            if (job.state.status == 'completed' && job.result) {
                if (!isStackingJob(job)) return;
                let result = job.result;
                if (result.errors.length != 0) {
                    console.error('Errors encountered during stacking: ', result.errors);
                }
                if (result.warnings.length != 0) {
                    console.error('Warnings encountered during stacking: ', result.warnings);
                }
                if (result.fileId) {
                    dispatch(new LoadLibrary()).subscribe(() => {
                        let layerEntities = this.store.selectSnapshot(DataFilesState.getLayerEntities)
                        let existingFileNames = Object.values(layerEntities).map(layer => layer.name)
                        let selectedFilenames = job.fileIds.map(id => layerEntities[id].name)
                        let outFilename = getLongestCommonStartingSubstring(selectedFilenames).replace(/_+$/, '').trim();

                        if (outFilename) {
                            outFilename = `${outFilename}_stack`
                            let base = outFilename
                            let iter = 0
                            while (existingFileNames.includes(`${outFilename}.fits`)) {
                                outFilename = `${base}_${iter}`
                                iter += 1;
                            }
                        }
                        this.dataFileService.updateFile(result.fileId, {
                            groupName: `${outFilename}.fits`,
                            name: `${outFilename}.fits`
                        }).pipe(
                            flatMap(() => dispatch(new LoadLibrary()))
                        ).subscribe()
                    })

                }
            }
        })

        return job$
    }

    @Action(CloseLayerSuccess)
    @ImmutableContext()
    public closeLayerSuccess(
        { getState, setState, dispatch }: StateContext<StackingStateModel>,
        { layerId: layerId }: CloseLayerSuccess
    ) {
        setState((state: StackingStateModel) => {
            state.formData.selectedLayerIds = state.formData.selectedLayerIds.filter(
                (id) => id != layerId
            );

            return state;
        });
    }




}


