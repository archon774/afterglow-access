import { Component, OnInit, HostBinding, Input, ChangeDetectionStrategy } from '@angular/core';
import { Observable, combineLatest, BehaviorSubject, Subject } from 'rxjs';
import { map, tap, takeUntil, distinctUntilChanged, flatMap, withLatestFrom, startWith } from 'rxjs/operators';
import { StackFormData } from '../../../models/workbench-state';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { StackingJob, StackingJobResult, StackSettings } from '../../../../jobs/models/stacking';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { DataFile, ImageLayer } from '../../../../data-files/models/data-file';
import { DataFilesState } from '../../../../data-files/data-files.state';
import { greaterThan, isNumber, lessThan } from 'src/app/utils/validators';
import { getLongestCommonStartingSubstring, isNotEmpty } from 'src/app/utils/utils';
import { StackingState, StackingStateModel } from '../stacking.state';
import { WorkbenchState } from 'src/app/workbench/workbench.state';
import { CreateStackingJob, SetCurrentJobId, UpdateFormData } from '../stacking.actions';
import { AligningState } from '../../aligning/aligning.state';

@Component({
  selector: 'app-stacking-panel',
  templateUrl: './stacking-panel.component.html',
  styleUrls: ['./stacking-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StackingPanelComponent implements OnInit {
  @Input('layerIds')
  set layerIds(layerIds: string[]) {
    this.layerIds$.next(layerIds);
  }
  get layerIds() {
    return this.layerIds$.getValue();
  }
  private layerIds$ = new BehaviorSubject<string[]>(null);

  config$: Observable<StackingStateModel>;
  formData$: Observable<StackFormData>;

  destroy$ = new Subject<boolean>();
  selectedLayers$: Observable<Array<ImageLayer>>;
  stackingJob$: Observable<StackingJob>;
  dataFileEntities$: Observable<{ [id: string]: DataFile }>;
  showPropagateMask$ = new BehaviorSubject<boolean>(false);

  stackForm = new FormGroup({
    selectedLayerIds: new FormControl([], Validators.required),
    mode: new FormControl('average', Validators.required),
    scaling: new FormControl('none', Validators.required),
    rejection: new FormControl('none', Validators.required),
    smartStacking: new FormControl('none', Validators.required),
    percentile: new FormControl(50, { validators: [Validators.required, isNumber, greaterThan(0)] }),
    low: new FormControl('', { validators: [Validators.required, isNumber, greaterThan(0, true)] }),
    high: new FormControl('', { validators: [Validators.required, isNumber, greaterThan(0, true)] }),
    nuCol: new FormControl('', {validators: [Validators.required, isNumber, greaterThan(0, true)] }),
    propagateMask: new FormControl(''),
    equalizeAdditive: new FormControl(''),
    equalizeOrder: new FormControl('', { validators: [Validators.required, isNumber, greaterThan(0, true)] }),
    equalizeMultiplicative: new FormControl(''),
    multiplicativePercentile: new FormControl('', { validators: [Validators.required, isNumber, greaterThan(0, true), lessThan(100, true)] }),
    equalizeGlobal: new FormControl(''),
  });

  submitDisabled$: Observable<boolean>;

  constructor(private store: Store, private router: Router) {
    this.dataFileEntities$ = this.store.select(DataFilesState.getFileEntities);
    this.config$ = this.store.select(StackingState.getState);
    this.formData$ = this.store.select(StackingState.getFormData)

    this.layerIds$.pipe(takeUntil(this.destroy$), withLatestFrom(this.formData$)).subscribe(([layerIds, formData]) => {
      if (!layerIds || !formData) return;
      let selectedLayerIds = formData.selectedLayerIds.filter((layerId) => layerIds.includes(layerId));
      if (selectedLayerIds.length != formData.selectedLayerIds.length) {
        setTimeout(() => {
          this.setSelectedLayerIds(selectedLayerIds);
        });
      }
    });

    this.store.select(AligningState.getFormData).pipe(
      takeUntil(this.destroy$),
      map(config => !config?.mosaicMode)
    ).subscribe(value => this.showPropagateMask$.next(value))

    this.stackForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.onStackSettingsFormChange());

    this.stackForm
      .get('equalizeAdditive')
      .valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((value) => {
        if (value) {
          this.stackForm.get('equalizeGlobal').setValue(true);
        }
      });


    this.formData$.pipe(
      takeUntil(this.destroy$)
    ).subscribe((data) => {
      this.stackForm.patchValue(data, { emitEvent: false });
    });

    this.stackingJob$ = this.store.select(StackingState.getCurrentJob)

    this.stackForm.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((value) => {
      // if(this.imageCalcForm.valid) {
      this.store.dispatch(new UpdateFormData({ ...this.stackForm.value }));
      // }
    });


    this.onStackSettingsFormChange();

    this.submitDisabled$ = this.stackingJob$.pipe(startWith(null)).pipe(
      // map(job => (job?.state?.status !== undefined && ['pending', 'in_progress'].includes(job.state.status)))
      //TODO: temporarily allow multiple stacking jobs.  In the future,  keep track of list of jobs and show status for all of them
      map(job => false)
    )


  }

  onStackSettingsFormChange() {

    let rejection = this.stackForm.get('rejection').value

    if (['iraf', 'minmax', 'sigclip', 'rcr', 'chauvenet'].includes(rejection)) {
      this.stackForm.get('high').enable({ emitEvent: false });
      this.stackForm.get('low').enable({ emitEvent: false });
    } else {
      this.stackForm.get('high').disable({ emitEvent: false });
      this.stackForm.get('low').disable({ emitEvent: false });
    }

    if (rejection === 'chauvenet') {
      this.stackForm.get('nuCol').enable({ emitEvent: false });
    } else {
      this.stackForm.get('nuCol').disable({ emitEvent: false });
      }
    let equalizeMultiplicative = this.stackForm.get('equalizeMultiplicative').value;
    if (equalizeMultiplicative) {
      this.stackForm.get('multiplicativePercentile').enable({ emitEvent: false });
    } else {
      this.stackForm.get('multiplicativePercentile').disable({ emitEvent: false });
    }

    let equalizeAdditive = this.stackForm.get('equalizeAdditive').value;
    if (equalizeAdditive) {
      this.stackForm.get('equalizeOrder').enable({ emitEvent: false });
    } else {
      this.stackForm.get('equalizeOrder').disable({ emitEvent: false });
    }

    let mode = this.stackForm.get('mode').value;
    if (mode == 'percentile') {
      this.stackForm.get('percentile').enable({ emitEvent: false });
    } else {
      this.stackForm.get('percentile').disable({ emitEvent: false });
    }

  }

  getLayerOptionLabel(layerId: string) {
    return this.store.select(DataFilesState.getLayerById(layerId)).pipe(
      map((layer) => layer?.name),
      distinctUntilChanged()
    );
  }

  setSelectedLayerIds(layerIds: string[]) {
    this.store.dispatch(
      new UpdateFormData({
        ...this.stackForm.value,
        selectedLayerIds: layerIds,
      })
    );
  }

  onSelectAllBtnClick() {
    this.setSelectedLayerIds(this.layerIds);
  }

  onClearSelectionBtnClick() {
    this.setSelectedLayerIds([]);
  }

  submit() {
    this.store.dispatch(new SetCurrentJobId(null));

    let showPropagateMask = this.showPropagateMask$.value;
    let selectedLayerIds: string[] = this.stackForm.controls.selectedLayerIds.value;
    let state = this.store.selectSnapshot(StackingState.getState)
    let data = state.formData;
    let layerEntities = this.store.selectSnapshot(DataFilesState.getLayerEntities);

    let dataFileEntities = this.store.selectSnapshot(DataFilesState.getFileEntities);
    selectedLayerIds = selectedLayerIds.filter((id) => isNotEmpty(layerEntities[id]));
    selectedLayerIds = selectedLayerIds.sort((a, b) => {
      let aFile = dataFileEntities[layerEntities[a].fileId];
      let bFile = dataFileEntities[layerEntities[b].fileId];
      return aFile.name < bFile.name
        ? -1
        : aFile.name > bFile.name
          ? 1
          : 0
    })





    let settings: StackSettings = {
      mode: data.mode,
      scaling: data.scaling == 'none' ? null : data.scaling,
      prescaling: data.scaling == 'none' ? null : data.scaling,
      rejection: data.rejection == 'none' ? null : data.rejection,
      percentile: data.percentile,
      smartStacking: data.smartStacking,
      lo: data.low,
      hi: data.high,
      nuCol: data.nuCol,
      propagateMask: showPropagateMask ? data.propagateMask : false,
      equalizeAdditive: data.equalizeAdditive,
      equalizeOrder: data.equalizeOrder,
      equalizeMultiplicative: data.equalizeMultiplicative,
      multiplicativePercentile: data.multiplicativePercentile,
      equalizeGlobal: data.equalizeGlobal
    }




    this.store.dispatch(new CreateStackingJob(selectedLayerIds, settings, null));
  }

  ngOnInit() { }

  ngOnDestroy(): void {
    this.destroy$.next(true);
    this.destroy$.unsubscribe();
  }
}
