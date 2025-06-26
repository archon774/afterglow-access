import {
  Component,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  OnInit,
  HostBinding,
  Input,
  EventEmitter,
  Output,
  ChangeDetectionStrategy,
} from '@angular/core';

import * as moment from 'moment';

import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { Select, Store, Actions, ofActionSuccessful, ofAction } from '@ngxs/store';
import { Observable, Subscription, combineLatest, BehaviorSubject, of, Subject, merge } from 'rxjs';
import {
  map,
  flatMap,
  tap,
  filter,
  catchError,
  mergeMap,
  distinctUntilChanged,
  withLatestFrom,
  switchMap,
  debounceTime,
  auditTime,
  distinct,
  takeUntil,
  startWith,
  shareReplay,
  skip,
  take,
} from 'rxjs/operators';

import * as jStat from 'jstat';
import { saveAs } from 'file-saver/dist/FileSaver';

import {
  getCenterTime,
  getSourceCoordinates,
  DataFile,
  ImageLayer,
  Header,
  ILayer,
  PixelType,
} from '../../../../data-files/models/data-file';
import { DmsPipe } from '../../../../pipes/dms.pipe';
import { Source, PosType } from '../../../models/source';
import { SelectionModel } from '@angular/cdk/collections';
import { CentroidSettings } from '../../../models/centroid-settings';
import { PhotometryJob, PhotometryData, isPhotometryJob } from '../../../../jobs/models/photometry';
import { Router } from '@angular/router';
import { MatButtonToggleChange } from '@angular/material/button-toggle';
import { WorkbenchState } from '../../../workbench.state';
import { AddSources, RemoveSources } from '../../../sources.actions';
import { PhotometrySettings } from '../../../models/photometry-settings';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { Papa } from 'ngx-papaparse';
import { datetimeToJd, formatDms, jdToMjd } from '../../../../utils/skynet-astro';
import { DatePipe } from '@angular/common';
import { SourceExtractionSettings } from '../../../models/source-extraction-settings';
import { JobsState } from '../../../../jobs/jobs.state';
import { DataFilesState } from '../../../../data-files/data-files.state';
import * as snakeCaseKeys from 'snakecase-keys';
import { SourcesState } from '../../../sources.state';
import { centroidPsf } from '../../../models/centroider';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';
import { ImageViewerEventService } from '../../../services/image-viewer-event.service';
import { ImageViewerMarkerService } from '../../../services/image-viewer-marker.service';
import { LayerType } from '../../../../data-files/models/data-file-type';
import { IImageData } from '../../../../data-files/models/image-data';
import { MarkerType, PhotometryMarker, RectangleMarker } from '../../../models/marker';
import { round } from '../../../../utils/math';
import { FieldCalibrationJob, FieldCalibrationJobResult, isFieldCalibrationJob, isFieldCalibrationJobResult } from 'src/app/jobs/models/field-calibration';
import { CalibrationSettings } from '../../../models/calibration-settings';
import { GlobalSettings } from '../../../models/global-settings';
import { Job } from 'src/app/jobs/models/job';
import { LoadJob, LoadJobResult } from 'src/app/jobs/jobs.actions';
import { SourcePanelConfig } from '../../../tools/source-catalog/models/source-panel-config';
import { SourceCatalogState } from '../../../tools/source-catalog/source-catalog.state';
import { EndSourceSelectionRegion, UpdateConfig as UpdateSourceCatalogConfig, UpdateSourceSelectionRegion } from '../../../tools/source-catalog/source-catalog.actions';
import { PhotometryState, PhotometryViewerStateModel } from '../photometry.state';
import { BatchPhotometryFormData, PhotometryPanelConfig } from '../models/photometry-panel-config';
import { BatchPhotometerSources, InvalidateAutoPhotByLayerId, RemovePhotDatasByLayerId, UpdateAutoFieldCalibration, UpdateAutoPhotometry, UpdateConfig } from '../photometry.actions';

@Component({
  selector: 'app-photometry-panel',
  templateUrl: './photometry-panel.component.html',
  styleUrls: ['./photometry-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotometryPanelComponent implements AfterViewInit, OnDestroy, OnInit {
  @Input('viewerId')
  set viewerId(viewer: string) {
    this.viewerIdSubject$.next(viewer);
  }
  get viewerId() {
    return this.viewerIdSubject$.getValue();
  }
  protected viewerIdSubject$ = new BehaviorSubject<string>(null);
  protected viewerId$ = this.viewerIdSubject$.asObservable().pipe(filter(viewerId => viewerId !== null))

  @Input('batchLayerIdOptions')
  set batchLayerIdOptions(batchLayerIdOptions: string[]) {
    this.batchLayerIdOptions$.next(batchLayerIdOptions);
  }
  get batchLayerIdOptions() {
    return this.batchLayerIdOptions$.getValue();
  }
  private batchLayerIdOptions$ = new BehaviorSubject<string[]>([]);

  destroy$ = new Subject<boolean>();
  viewportSize$: Observable<{ width: number; height: number }>;
  file$: Observable<DataFile>;
  layer$: Observable<ILayer>;
  imageLayer$: Observable<ImageLayer>;
  header$: Observable<Header>;
  rawImageData$: Observable<IImageData<PixelType>>;
  sources$: Observable<Source[]>;
  state$: Observable<PhotometryViewerStateModel>;
  config$: Observable<PhotometryPanelConfig>;
  sourcePanelConfig$: Observable<SourcePanelConfig>;
  globalSettings$: Observable<GlobalSettings>;
  photometrySettings$: Observable<PhotometrySettings>;
  calibrationSettings$: Observable<CalibrationSettings>;
  centroidSettings$: Observable<CentroidSettings>;
  sourceExtractionSettings$: Observable<SourceExtractionSettings>;

  //events
  onRemoveAllSources$ = new Subject<any>();

  NUMBER_FORMAT: (v: any) => any = (v: number) => (v ? v : 'N/A');
  DECIMAL_FORMAT: (v: any) => any = (v: number) => (v ? v.toFixed(2) : 'N/A');
  SEXAGESIMAL_FORMAT: (v: any) => any = (v: number) => (v ? this.dmsPipe.transform(v) : 'N/A');
  SourcePosType = PosType;
  tableData$: Observable<{ source: Source; data: PhotometryData }[]>;
  batchPhotJob$: Observable<PhotometryJob>;
  batchCalJob$: Observable<FieldCalibrationJob>;
  batchStatus$: Observable<{ inProgress: boolean, calibrationEnabled: boolean; photJob: PhotometryJob, calJob: FieldCalibrationJob }>;
  creatingBatchJobs$: Observable<boolean>;
  autoPhotJob$: Observable<PhotometryJob>;
  autoPhotData$: Observable<{ [sourceId: string]: PhotometryData }>;
  autoCalJob$: Observable<FieldCalibrationJob>;
  batchCalibrationEnabled$: Observable<boolean>;
  mergeError: string;
  selectionModel = new SelectionModel<string>(true, []);
  zeroPointCorrection$: Observable<number>;
  calibratedZeroPoint$: Observable<number>;

  batchPhotForm = new FormGroup({
    selectedLayerIds: new FormControl([], Validators.required),
  });
  batchPhotFormData$: Observable<BatchPhotometryFormData>;

  submitDisabled$: Observable<boolean>;

  constructor(
    private dialog: MatDialog,
    private dmsPipe: DmsPipe,
    private datePipe: DatePipe,
    private papa: Papa,
    private store: Store,
    private eventService: ImageViewerEventService,
    private markerService: ImageViewerMarkerService
  ) {
    this.viewportSize$ = this.viewerId$.pipe(
      switchMap((viewerId) => this.store.select(WorkbenchState.getViewportSizeByViewerId(viewerId)))
    );

    this.config$ = this.store.select(PhotometryState.getConfig);
    this.sourcePanelConfig$ = this.store.select(SourceCatalogState.getConfig);

    this.state$ = this.viewerId$.pipe(
      switchMap((viewerId) => this.store.select(PhotometryState.getPhotometryViewerStateByViewerId(viewerId))),
      filter(state => !!state)
    );

    this.file$ = this.viewerId$.pipe(
      switchMap((viewerId) => this.store.select(WorkbenchState.getFileByViewerId(viewerId)))
    );

    this.layer$ = this.viewerId$.pipe(
      switchMap((viewerId) => this.store.select(WorkbenchState.getLayerByViewerId(viewerId)))
    );

    this.imageLayer$ = this.layer$.pipe(map((layer) => (layer && layer.type == LayerType.IMAGE ? (layer as ImageLayer) : null)));

    this.header$ = this.viewerId$.pipe(
      switchMap((viewerId) => this.store.select(WorkbenchState.getLayerHeaderByViewerId(viewerId)))
    );

    this.rawImageData$ = this.viewerId$.pipe(
      switchMap((viewerId) => this.store.select(WorkbenchState.getRawImageDataByViewerId(viewerId)))
    );

    this.sources$ = combineLatest(
      this.store.select(SourcesState.getEntities),
      this.sourcePanelConfig$.pipe(
        map((config) => config.coordMode),
        distinctUntilChanged()
      ),
      this.sourcePanelConfig$.pipe(
        map((config) => config.showSourcesFromAllFiles),
        distinctUntilChanged()
      ),
      this.imageLayer$.pipe(map(layer => layer?.id), distinctUntilChanged()),
      this.header$
    ).pipe(
      map(([sourceEntities, coordMode, showSourcesFromAllFiles, imageLayerId, header]) => {
        if (!header) return [];
        if (!header.wcs || !header.wcs.isValid()) coordMode = 'pixel';
        let localSourceLabels = Object.values(sourceEntities).filter(source => source.layerId == imageLayerId).map(source => source.label)

        return Object.values(sourceEntities).filter((source) => {
          if (coordMode != source.posType) return false;
          if (source.layerId == imageLayerId) return true;
          if (!showSourcesFromAllFiles) return false;
          if (localSourceLabels.includes(source.label)) return false;
          // let coord = getSourceCoordinates(header, source);
          // if (coord == null) return false;
          return true;
        });
      }),
      shareReplay(1)
    );

    this.globalSettings$ = this.store.select(WorkbenchState.getSettings)
    this.photometrySettings$ = this.store.select(WorkbenchState.getPhotometrySettings);
    this.calibrationSettings$ = this.store.select(WorkbenchState.getCalibrationSettings);
    this.centroidSettings$ = this.store.select(WorkbenchState.getCentroidSettings);
    this.sourceExtractionSettings$ = this.store.select(WorkbenchState.getSourceExtractionSettings);

    this.batchCalibrationEnabled$ = this.config$.pipe(
      map(c => c.batchCalibrationEnabled)
    )

    let autoPhotIsValid$ = combineLatest([this.state$, this.config$]).pipe(
      map(([s, config]) => !config.autoPhot || s.autoPhotIsValid),
      distinctUntilChanged()
    );

    let autoPhotJobId$ = this.state$.pipe(
      map((s) => s.autoPhotJobId),
      distinctUntilChanged()
    )

    this.autoPhotJob$ = autoPhotJobId$.pipe(
      switchMap(id => this.store.select(JobsState.getJobById(id)).pipe(
        map(job => job && isPhotometryJob(job) ? job : null)
      )
      ))


    this.autoPhotData$ = this.autoPhotJob$.pipe(
      map(job => {
        let result = {};
        if (!job || !job.result) return {};
        job.result.data.forEach(d => {
          let time: Date = null;
          if (d.time && Date.parse(d.time + ' GMT')) {
            time = new Date(Date.parse(d.time + ' GMT'));
          }
          result[d.id] = {
            ...d,
            time: time
          }
        })
        return result;
      })
    )


    let autoCalIsValid$ = combineLatest([this.state$, this.config$]).pipe(
      map(([s, config]) => !config.autoPhot || s.autoCalIsValid),
      distinctUntilChanged()
    );

    let autoCalJobId$ = this.state$.pipe(
      map((s) => s?.autoCalJobId),
      distinctUntilChanged()
    )

    this.autoCalJob$ = autoCalJobId$.pipe(
      switchMap(id => this.store.select(JobsState.getJobById(id)).pipe(
        map(job => job && isFieldCalibrationJob(job) ? job : null)
      )
      ))

    // determine whether existing jobs have been loaded
    this.viewerId$.subscribe(viewerId => {
      let state = this.store.selectSnapshot(PhotometryState.getPhotometryViewerStateByViewerId(viewerId));

      if (!state) return;

      let loadJob = (id) => {
        if (id) {
          let job = this.store.selectSnapshot(JobsState.getJobById(id))
          if (!job) this.store.dispatch(new LoadJob(id))
          if (!job || !job.result) this.store.dispatch(new LoadJobResult(id))
        }
      }

      if (state.autoCalIsValid) loadJob(state.autoCalJobId);
      if (state.autoPhotIsValid) loadJob(state.autoPhotJobId);
    })

    let calibrationEnabled$ = this.calibrationSettings$.pipe(map(s => s.calibrationEnabled), distinctUntilChanged());
    let fixedZeroPoint$ = this.calibrationSettings$.pipe(map(s => s.zeroPoint), distinctUntilChanged())
    this.zeroPointCorrection$ = this.autoCalJob$.pipe(
      map(job => job?.result?.data[0]?.zeroPointCorr),
      startWith(null),
      distinctUntilChanged()
    )

    this.calibratedZeroPoint$ = combineLatest([calibrationEnabled$, this.zeroPointCorrection$, fixedZeroPoint$]).pipe(
      map(([calibrationEnabled, zeroPointCorrection, fixedZeroPoint]) => fixedZeroPoint + zeroPointCorrection),
      distinctUntilChanged()
    )

    this.tableData$ = combineLatest(
      [this.sources$,
      this.autoPhotData$,
      this.zeroPointCorrection$]
    ).pipe(
      map(([sources, photometryData, zeroPointCorrection]) => {
        return sources.map((source) => {
          let d: PhotometryData = photometryData[source.id] || null;
          if (d) {
            d = {
              ...d,
              mag: d.mag + (zeroPointCorrection || 0)
            }
          }

          return {
            source: source,
            data: d,
          };
        });
      })
    );


    // this.tableData$.subscribe(data => console.log("TABLE DATA: ", data))
    let batchCalJobId$ = this.config$.pipe(
      map((s) => s.batchCalJobId),
      distinctUntilChanged()
    )

    this.batchCalJob$ = batchCalJobId$.pipe(
      switchMap(id => this.store.select(JobsState.getJobById(id)).pipe(
        map(job => job && isFieldCalibrationJob(job) ? job : null)
      )
      ))

    let batchPhotJobId$ = this.config$.pipe(
      map((s) => s.batchPhotJobId),
      distinctUntilChanged()
    )

    this.batchPhotJob$ = batchPhotJobId$.pipe(
      switchMap(id => this.store.select(JobsState.getJobById(id)).pipe(
        map(job => job && isPhotometryJob(job) ? job : null)
      ))
    )

    this.creatingBatchJobs$ = this.config$.pipe(
      map((s) => s.creatingBatchJobs),
      distinctUntilChanged()
    )

    this.batchStatus$ = combineLatest([this.creatingBatchJobs$, this.batchCalibrationEnabled$, this.batchPhotJob$, this.batchCalJob$]).pipe(
      map(([creatingBatchJobs, calibrationEnabled, batchPhotJob, batchCalJob]) => {
        let inProgressStates = ['in_progress', 'pending'];
        let status = {
          calibrationEnabled: calibrationEnabled,
          photJob: batchPhotJob,
          calJob: batchCalJob,
          inProgress: creatingBatchJobs
        }

        if (batchPhotJob) status.inProgress = inProgressStates.includes(batchPhotJob.state.status);
        if (calibrationEnabled && batchCalJob) status.inProgress = status.inProgress || inProgressStates.includes(batchCalJob.state.status);

        return status;
      })
    )

    // determine whether existing jobs have been loaded
    let config = this.store.selectSnapshot(PhotometryState.getConfig);
    if (config.batchPhotJobId) {
      let batchPhotJob = this.store.selectSnapshot(JobsState.getJobById(config.batchPhotJobId))
      if (!batchPhotJob) this.store.dispatch(new LoadJob(config.batchPhotJobId))
      if (!batchPhotJob || !batchPhotJob.result) this.store.dispatch(new LoadJobResult(config.batchPhotJobId))
    }
    if (config.batchCalJobId) {
      let batchCalJob = this.store.selectSnapshot(JobsState.getJobById(config.batchCalJobId))
      if (!batchCalJob) this.store.dispatch(new LoadJob(config.batchCalJobId))
      if (!batchCalJob || !batchCalJob.result) this.store.dispatch(new LoadJobResult(config.batchCalJobId))
    }


    this.batchPhotFormData$ = this.config$.pipe(
      filter((config) => config !== null),
      map((config) => config.batchPhotFormData),
      distinctUntilChanged(),
      tap((data) => {
        this.batchPhotForm.patchValue(data, { emitEvent: false });
      })
    );

    this.batchPhotFormData$.pipe(takeUntil(this.destroy$)).subscribe();

    this.batchPhotForm.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((value) => {
      // if(this.imageCalcForm.valid) {
      this.store.dispatch(
        new UpdateConfig({
          batchPhotFormData: this.batchPhotForm.value,
        })
      );
      // }
    });

    combineLatest(this.sources$, this.sourcePanelConfig$)
      .pipe(
        filter(([sources, config]) => sources !== null && config !== null),
        map(([sources, config]) => sources.filter((s) => config.selectedSourceIds.includes(s.id)).map((s) => s.id)),
        takeUntil(this.destroy$)
      )
      .subscribe((selectedSourceIds) => {
        this.selectionModel.clear();
        this.selectionModel.select(...selectedSourceIds);
      });

    // this.tableData$
    //   .pipe(
    //     takeUntil(this.destroy$),
    //     filter((rows) => rows.filter((row) => row.data === null).length != 0),
    //     withLatestFrom(this.imageLayer$, this.config$, this.photometrySettings$),
    //     filter(([rows, imageLayer, config]) => rows.length != 0 && imageLayer && config && config.autoPhot),
    //     auditTime(100)
    //   )
    //   .subscribe(([rows, imageLayer, config, photometrySettings]) => {
    //     this.store.dispatch(
    //       new PhotometerSources(
    //         rows.map((row) => row.source.id),
    //         [imageLayer.id],
    //         false
    //       )
    //     );
    //   });

    // autoPhotIsValid$.subscribe(valid => console.log("IS VALID:::: ", valid))

    autoPhotIsValid$.pipe(
      takeUntil(this.destroy$),
      withLatestFrom(this.header$),
      switchMap(([isValid, header]) => {
        if (header?.loaded) return of(isValid);

        //wait for header to be loaded
        return this.store.select(DataFilesState.getHeaderById(header.id)).pipe(
          filter(header => header.loaded),
          take(1),
          map(header => {
            return isValid
          })
        )
      }),
      withLatestFrom(autoPhotJobId$)
    ).subscribe(([isValid, jobId]) => {
      if (!this.viewerId) return;
      //handle case where job ID is present and valid, but job is not in store
      if (!isValid || (jobId && !this.store.selectSnapshot(JobsState.getJobById(jobId)))) this.store.dispatch(new UpdateAutoPhotometry(this.viewerId))
    })


    combineLatest([autoCalIsValid$, calibrationEnabled$]).pipe(
      takeUntil(this.destroy$),
      withLatestFrom(this.header$),
      switchMap(([[isValid, calibrationEnabled], header]) => {
        if (header?.loaded) return of([isValid, calibrationEnabled]);

        //wait for header to be loaded
        return this.store.select(DataFilesState.getHeaderById(header.id)).pipe(
          filter(header => header.loaded),
          take(1),
          map(header => {
            return [isValid, calibrationEnabled]
          })
        )
      }),
      withLatestFrom(autoCalJobId$)
    ).subscribe(([[isValid, calibrationEnabled], jobId]) => {
      if (calibrationEnabled && (!isValid || (jobId && !this.store.selectSnapshot(JobsState.getJobById(jobId))))) this.store.dispatch(new UpdateAutoFieldCalibration(this.viewerId))
    })

    // combineLatest([
    //   this.header$.pipe(
    //     map(header => header?.loaded),
    //     distinctUntilChanged()
    //   ),
    //   autoCalIsValid$,
    //   calibrationEnabled$
    // ]).pipe(
    //   takeUntil(this.destroy$),
    //   debounceTime(100),
    //   withLatestFrom(this.autoCalJob$)
    // ).subscribe(([[headerLoaded, isValid, calibrationEnabled], job]) => {
    //   if (!headerLoaded || !this.viewerId || !calibrationEnabled) return;
    //   if (!isValid || !job) this.store.dispatch(new UpdateAutoFieldCalibration(this.viewerId))
    // })

    // combineLatest([this.calibrationSettings$, this.photometrySettings$, this.sourceExtractionSettings$]).pipe(
    //   takeUntil(this.destroy$),
    //   debounceTime(100),

    // ).subscribe(([calibrationSettings]) => {
    //   this.store.dispatch(new RemoveAutoCalJobsByLayerId())
    // })

    this.eventService.imageClickEvent$
      .pipe(
        takeUntil(this.destroy$),
        withLatestFrom(this.state$, this.sourcePanelConfig$, this.imageLayer$, this.header$, this.rawImageData$)
      )
      .subscribe(([$event, state, sourcePanelConfig, imageLayer, header, imageData]) => {
        if (!$event || !imageData) {
          return;
        }

        if (!$event.isActiveViewer) return;

        let selectedSourceIds = sourcePanelConfig.selectedSourceIds;
        let centroidClicks = sourcePanelConfig.centroidClicks;
        let centroidSettings = this.store.selectSnapshot(WorkbenchState.getCentroidSettings);

        if ($event.hitImage) {
          if (selectedSourceIds.length == 0 || $event.mouseEvent.altKey) {
            let primaryCoord = $event.imageX;
            let secondaryCoord = $event.imageY;
            let posType = PosType.PIXEL;
            if (centroidClicks) {
              let result = centroidPsf(imageData, primaryCoord, secondaryCoord, centroidSettings);
              primaryCoord = result.x;
              secondaryCoord = result.y;
            }
            if (sourcePanelConfig.coordMode == 'sky' && header?.wcs?.isValid()) {
              let wcs = header.wcs;
              let raDec = wcs.pixToWorld([primaryCoord, secondaryCoord]);
              primaryCoord = raDec[0];
              secondaryCoord = raDec[1];
              posType = PosType.SKY;
            }

            let centerEpoch = getCenterTime(header);

            let source: Source = {
              id: null,
              label: null,
              objectId: null,
              layerId: imageLayer.id,
              primaryCoord: primaryCoord,
              secondaryCoord: secondaryCoord,
              posType: posType,
              pm: null,
              pmPosAngle: null,
              pmEpoch: centerEpoch ? centerEpoch.toISOString() : null,
            };
            this.store.dispatch([new AddSources([source]), new InvalidateAutoPhotByLayerId()]);
          } else if (!$event.mouseEvent.ctrlKey) {
            this.store.dispatch(
              new UpdateSourceCatalogConfig({
                selectedSourceIds: [],
              })
            );
          }
        }
      });

    this.eventService.mouseDragEvent$
      .pipe(
        takeUntil(this.destroy$),
        withLatestFrom(this.state$, this.config$, this.imageLayer$, this.header$, this.rawImageData$)
      )
      .subscribe(([$event, state, config, imageLayer, header, imageData]) => {
        if (!$event) {
          return;
        }
        if (!$event.$mouseDownEvent.ctrlKey && !$event.$mouseDownEvent.metaKey && !$event.$mouseDownEvent.shiftKey)
          return;
        if (!imageLayer) return;
        if (!$event.isActiveViewer) return;

        let region = {
          x: $event.imageStart.x,
          y: $event.imageStart.y,
          width: $event.imageEnd.x - $event.imageStart.x,
          height: $event.imageEnd.y - $event.imageStart.y,
        };

        this.store.dispatch(new UpdateSourceSelectionRegion(imageLayer.id, region));
      });

    this.eventService.mouseDropEvent$
      .pipe(
        takeUntil(this.destroy$),
        withLatestFrom(this.state$, this.config$, this.imageLayer$, this.header$, this.rawImageData$)
      )
      .subscribe(([$event, state, config, imageLayer, header, imageData]) => {
        if (!$event) {
          return;
        }
        if (!$event.$mouseDownEvent.ctrlKey && !$event.$mouseDownEvent.metaKey && !$event.$mouseDownEvent.shiftKey)
          return;
        if (!imageLayer) return;
        if (!$event.isActiveViewer) return;

        this.store.dispatch(
          new EndSourceSelectionRegion(imageLayer.id, $event.$mouseUpEvent.shiftKey ? 'remove' : 'append')
        );
      });

    this.eventService.markerClickEvent$.pipe(takeUntil(this.destroy$)).subscribe(($event) => {
      if (!$event) {
        return;
      }
      if ($event.mouseEvent.altKey) return;
      let sources = this.store.selectSnapshot(SourcesState.getSources);
      let source = sources.find(
        (source) => $event.marker.data && $event.marker.data.source && source.id == $event.marker.data.source.id
      );
      if (!source) return;
      if (!$event.isActiveViewer) return;

      let sourcePanelConfig = this.store.selectSnapshot(SourceCatalogState.getConfig);
      let sourceSelected = sourcePanelConfig.selectedSourceIds.includes(source.id);
      if ($event.mouseEvent.ctrlKey) {
        if (!sourceSelected) {
          // select the source
          this.store.dispatch(
            new UpdateSourceCatalogConfig({
              selectedSourceIds: [...sourcePanelConfig.selectedSourceIds, source.id],
            })
          );
        } else {
          // deselect the source
          let selectedSourceIds = sourcePanelConfig.selectedSourceIds.filter((id) => id != source.id);
          this.store.dispatch(
            new UpdateSourceCatalogConfig({
              selectedSourceIds: selectedSourceIds,
            })
          );
        }
      } else {
        this.store.dispatch(
          new UpdateSourceCatalogConfig({
            selectedSourceIds: [source.id],
          })
        );
      }
      $event.mouseEvent.stopImmediatePropagation();
      $event.mouseEvent.preventDefault();
    });



    // events
    this.onRemoveAllSources$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(
      (event) => {
        //remove all sources,  even those from other files
        let sources = this.store.selectSnapshot(SourcesState.getSources);
        this.store.dispatch(new RemoveSources(sources.map(s => s.id)));
      }
    )

    this.submitDisabled$ = combineLatest([this.batchCalJob$.pipe(startWith(null)), this.batchPhotJob$.pipe(startWith(null))]).pipe(
      map(([calJob, photJob]) => (calJob?.state?.status !== undefined && ['pending', 'in_progress'].includes(calJob.state.status)) || (photJob?.state?.status !== undefined && ['pending', 'in_progress'].includes(photJob.state.status)))
    )

  }

  ngOnInit() {
    /** markers */
    let visibleViewerIds$: Observable<string[]> = this.store.select(WorkbenchState.getVisibleViewerIds).pipe(
      distinctUntilChanged((x, y) => {
        return x.length == y.length && x.every((value, index) => value == y[index]);
      })
    );

    visibleViewerIds$
      .pipe(
        takeUntil(this.destroy$),
        switchMap((viewerIds) => {
          return merge(...viewerIds.map((viewerId) => this.getViewerMarkers(viewerId))).pipe(
            takeUntil(this.destroy$),
          );
        })
      )
      .subscribe((v) => {
        this.markerService.updateMarkers(v.viewerId, v.markers);
      });
  }

  ngAfterViewInit() { }

  ngOnDestroy() {
    this.markerService.clearMarkers();
    this.destroy$.next(true);
    this.destroy$.unsubscribe();
  }

  // onColorPickerChange(value: string) {
  //   this.markerColor$.next(value);
  // }

  private getViewerMarkers(viewerId: string) {
    let config$ = this.store.select(PhotometryState.getConfig)
    let state$ = this.store.select(SourceCatalogState.getSourceCatalogViewerStateByViewerId(viewerId)).pipe(distinctUntilChanged());
    let layerId$ = this.store.select(WorkbenchState.getImageLayerByViewerId(viewerId)).pipe(map(layer => layer?.id), distinctUntilChanged())
    // let layerId$ = this.imageLayer$.pipe(
    //   map((layer) => layer?.id),
    //   distinctUntilChanged()
    // );
    let header$ = this.store.select(WorkbenchState.getHeaderByViewerId(viewerId))

    let sourceSelectionRegionMarkers$ = combineLatest([layerId$, state$]).pipe(
      map(([layerId, state]) => {
        if (!state || !state.markerSelectionRegion) return [];
        let region = state.markerSelectionRegion;
        let sourceSelectionMarker: RectangleMarker = {
          id: `PHOTOMETRY_SOURCE_SELECTION_${layerId}`,
          x: Math.min(region.x, region.x + region.width),
          y: Math.min(region.y, region.y + region.height),
          width: Math.abs(region.width),
          height: Math.abs(region.height),
          type: MarkerType.RECTANGLE,
        };
        return [sourceSelectionMarker];
      })
    );

    let o1$ = combineLatest([this.sourcePanelConfig$, this.config$, this.autoPhotData$, this.zeroPointCorrection$]);
    let o2$ = combineLatest([header$, layerId$, this.sources$, this.photometrySettings$])
    let sourceMarkers$ = combineLatest([o1$, o2$]).pipe(
      map(([[sourcePanelConfig, config, autoPhotData, zeroPointCorrection], [header, layerId, sources, settings]]) => {
        if (!sourcePanelConfig?.showSourceMarkers || !header || !header.loaded || !autoPhotData) return [];
        let selectedSourceIds = sourcePanelConfig.selectedSourceIds;
        let coordMode = sourcePanelConfig.coordMode;
        let showSourcesFromAllFiles = sourcePanelConfig.showSourcesFromAllFiles;
        let showSourceLabels = sourcePanelConfig.showSourceLabels;

        let markers: Array<PhotometryMarker | RectangleMarker> = [];
        let mode = coordMode;

        if (!header.wcs || !header.wcs.isValid()) mode = 'pixel';

        sources.forEach((source) => {
          if (source.layerId != layerId && !showSourcesFromAllFiles) return;
          if (source.posType != mode) return;
          let selected = selectedSourceIds.includes(source.id);
          let coord = getSourceCoordinates(header, source);

          if (coord == null) {
            return;
          }

          let photometryData = autoPhotData[source.id];
          let tooltipMessage = [];
          if (source.label) tooltipMessage.push(source.label)
          if (photometryData) {

            if (photometryData.raHours !== null && photometryData.decDegs !== null) {
              tooltipMessage.push(
                `RA,DEC: (${formatDms(photometryData.raHours, 2, 3)}, ${formatDms(photometryData.decDegs, 2, 3)})`
              );
            }
            if (photometryData.x !== null && photometryData.y !== null) {
              tooltipMessage.push(`X,Y: (${round(photometryData.x, 3)}, ${round(photometryData.y, 3)})`);
            }

            if (photometryData.mag !== null && photometryData.magError !== null) {
              tooltipMessage.push(`${round(photometryData.mag + (zeroPointCorrection || 0), 3)} +/- ${round(photometryData.magError, 3)} mag`);
            }
          }

          let marker: PhotometryMarker = {
            id: `PHOTOMETRY_SOURCE_${layerId}_${source.id}`,
            type: MarkerType.PHOTOMETRY,
            ...coord,
            source: source,
            photometryData: photometryData,
            selected: selected,
            data: { source: source },
            tooltip: {
              class: 'photometry-data-tooltip',
              message: tooltipMessage.join('\n'),
              showDelay: 500,
              hideDelay: null,
            },
            label: sourcePanelConfig.showSourceLabels ? source.label : '',
            labelRadius: 10,
            showAperture: config.showSourceApertures,
            showCrosshair: true,
            style: {
              stroke: settings.markerColor,
              selectedStroke: settings.selectedMarkerColor
            }
          }

          markers.push(marker);
        });

        return markers;
      })
    );

    return combineLatest(sourceSelectionRegionMarkers$, sourceMarkers$).pipe(
      map(([sourceSelectionRegionMarkers, sourceMarkers]) => {
        return {
          viewerId: viewerId,
          markers: sourceMarkers.concat(sourceSelectionRegionMarkers),
        };
      })
    );
  }

  getLayerOptionLabel(layerId: string) {
    return this.store.select(DataFilesState.getLayerById(layerId)).pipe(
      map((layer) => layer?.name),
      distinctUntilChanged()
    );
  }

  selectSources(sources: Source[]) {
    let selectedSourceIds = this.store.selectSnapshot(SourceCatalogState.getConfig).selectedSourceIds;

    this.store.dispatch(
      new UpdateSourceCatalogConfig({
        selectedSourceIds: [
          ...selectedSourceIds,
          ...sources.filter((s) => !selectedSourceIds.includes(s.id)).map((s) => s.id),
        ],
      })
    );
  }

  deselectSources(sources: Source[]) {
    let idsToRemove = sources.map((s) => s.id);
    let selectedSourceIds = this.store
      .selectSnapshot(SourceCatalogState.getConfig)
      .selectedSourceIds.filter((id) => !idsToRemove.includes(id));

    this.store.dispatch(
      new UpdateSourceCatalogConfig({
        selectedSourceIds: selectedSourceIds,
      })
    );
  }

  toggleSource(source: Source) {
    if (this.selectionModel.isSelected(source.id)) {
      this.deselectSources([source]);
    } else {
      this.selectSources([source]);
    }
  }

  removeSelectedSources() {
    let selectedSourceIds = this.store
      .selectSnapshot(SourceCatalogState.getConfig).selectedSourceIds

    this.store.dispatch(new RemoveSources(selectedSourceIds));
  }

  removeSources() {
    this.onRemoveAllSources$.next()
  }



  updatePhotometry() {
    if (this.viewerId) {
      this.store.dispatch([new UpdateAutoPhotometry(this.viewerId), new UpdateAutoFieldCalibration(this.viewerId)])
    }
    // let photometrySettings = this.store.selectSnapshot(WorkbenchState.getPhotometrySettings);

    // this.store.dispatch(new RemovePhotDatasByLayerId());
    // this.store.dispatch(
    //   new PhotometerSources(
    //     sources.map((s) => s.id),
    //     [imageFile.id],
    //     false
    //   )
    // );
  }

  showSelectAll(sources: Source[]) {
    return sources && sources.length != 0;
  }

  isAllSelected(sources: Source[]) {
    const numSelected = this.selectionModel.selected.length;
    const numRows = sources.length;
    return numSelected === numRows;
  }

  exportSourceData(rows: Array<{ source: Source; data: PhotometryData }>) {
    let data = this.papa.unparse(
      rows.map((row) => {
        let data = {
          annulusAIn: null,
          annulusAOut: null,
          annulusBIn: null,
          annulusBOut: null,
          annulusThetaIn: null,
          annulusThetaOut: null,
          aperA: null,
          aperB: null,
          aperTheta: null,
          decDegs: null,
          expLength: null,
          fileId: null,
          filter: null,
          flux: null,
          fluxError: null,
          fwhmX: null,
          fwhmY: null,
          id: null,
          mag: null,
          magError: null,
          pmEpoch: null,
          pmPixel: null,
          pmPosAnglePixel: null,
          pmPosAngleSky: null,
          pmSky: null,
          raHours: null,
          telescope: null,
          theta: null,
          ...row.data
        }
        let time = data?.time ? moment.utc(data.time, 'YYYY-MM-DD HH:mm:ss.SSS').toDate() : null;
        let pmEpoch = row.source.pmEpoch ? moment.utc(row.source.pmEpoch, 'YYYY-MM-DD HH:mm:ss.SSS').toDate() : null;
        // console.log(time.getUTCFullYear(), time.getUTCMonth()+1, time.getUTCDate(), time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds(), datetimeToJd(time.getUTCFullYear(), time.getUTCMonth()+1, time.getUTCDate(), time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds()))
        let jd = time ? datetimeToJd(time) : null;
        return {
          ...row.source,
          ...data,
          time: time ? this.datePipe.transform(time, 'yyyy-MM-dd HH:mm:ss.SSS') : null,
          pm_epoch: pmEpoch ? this.datePipe.transform(pmEpoch, 'yyyy-MM-dd HH:mm:ss.SSS') : null,
          jd: jd,
          mjd: jd ? jdToMjd(jd) : null,
        };
      })
      // .sort((a, b) => (a.jd > b.jd ? 1 : -1))
    );
    var blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `afterglow_sources.csv`);
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle(sources: Source[]) {
    if (this.isAllSelected(sources)) {
      this.store.dispatch(
        new UpdateSourceCatalogConfig({
          selectedSourceIds: [],
        })
      );
    } else {
      this.store.dispatch(
        new UpdateSourceCatalogConfig({
          selectedSourceIds: sources.map((s) => s.id),
        })
      );
    }
  }

  trackByFn(index: number, value: Source) {
    return value.id;
  }


  clearPhotDataFromAllFiles() {
    this.store.dispatch(new RemovePhotDatasByLayerId());
  }

  selectLayers(layerIds: string[]) {
    this.store.dispatch(
      new UpdateConfig({
        batchPhotFormData: {
          ...this.batchPhotForm.value,
          selectedLayerIds: layerIds,
        },
      })
    );
  }

  batchPhotometer() {
    this.store.dispatch(new BatchPhotometerSources())
  }

  downloadBatchPhotData() {
    let config = this.store.selectSnapshot(PhotometryState.getConfig);

    let job: Job;

    job = this.store.selectSnapshot(JobsState.getJobById(config.batchPhotJobId))
    if (!isPhotometryJob(job)) return;
    let photJob = job;

    let calJob: FieldCalibrationJob;

    if (config.batchCalJobId) {
      let job = this.store.selectSnapshot(JobsState.getJobById(config.batchCalJobId));

      if (!isFieldCalibrationJob(job)) return;
      calJob = job;
    }

    let photData = photJob?.result?.data || [];

    let data = this.papa.unparse(
      snakeCaseKeys(
        photData.map((photRow) => {

          let time = photRow.time ? moment.utc(photRow.time, 'YYYY-MM-DD HH:mm:ss.SSS').toDate() : null;
          let pmEpoch = photRow.pmEpoch ? moment.utc(photRow.pmEpoch, 'YYYY-MM-DD HH:mm:ss.SSS').toDate() : null;
          // console.log(time.getUTCFullYear(), time.getUTCMonth()+1, time.getUTCDate(), time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds(), datetimeToJd(time.getUTCFullYear(), time.getUTCMonth()+1, time.getUTCDate(), time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds()))
          let jd = time ? datetimeToJd(time) : null;
          let result = {
            ...photRow,
            time: time ? this.datePipe.transform(time, 'yyyy-MM-dd HH:mm:ss.SSS') : null,
            pmEpoch: pmEpoch ? this.datePipe.transform(pmEpoch, 'yyyy-MM-dd HH:mm:ss.SSS') : null,
            jd: jd,
            mjd: jd ? jdToMjd(jd) : null,
            zero_point: photJob.settings.zeroPoint
          };

          if (calJob) {
            result['zero_point_correction'] = null;
            result['zero_point_error'] = null;
            result['calibrated_zero_point'] = null;
            result['calibrated_mag'] = null;

            let calRow = calJob.result?.data?.find(row => row.fileId == photRow.fileId);
            if (calRow) {
              result['zero_point_correction'] = calRow.zeroPointCorr;
              result['zero_point_error'] = calRow.zeroPointError
              result['calibrated_zero_point'] = calJob.photometrySettings.zeroPoint + calRow.zeroPointCorr;
              if (photRow.mag) result['calibrated_mag'] = photRow.mag + ((calJob.photometrySettings.zeroPoint + calRow.zeroPointCorr) - photJob.settings.zeroPoint);
            }
          }


          return result;
        })
      ),
      {
        columns: [
          'file_id',
          'id',
          'time',
          'jd',
          'mjd',
          'ra_hours',
          'dec_degs',
          'x',
          'y',
          'telescope',
          'filter',
          'exp_length',
          'mag',
          'mag_error',
          'zero_point',
          'flux',
          'flux_error',
          'pm_sky',
          'pm_epoch',
          'pm_pos_angle_sky',
          'zero_point_correction',
          'zero_point_error',
          'calibrated_zero_point',
          'calibrated_mag'
        ],
      }
      // .sort((a, b) => (a.jd > b.jd ? 1 : -1))
    );
    var blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `afterglow_photometry.csv`);

    // let sources = this.store.selectSnapshot(SourcesState.getEntities);
    // let data = this.store.selectSnapshot(PhotDataState.getSourcesPhotData).map(d => {
    //   return {
    //     ...sources[d.sourceId],
    //     ...d
    //   }
    // });
    // let blob = new Blob([this.papa.unparse(data)], { type: "text/plain;charset=utf-8" });
    // saveAs(blob, `afterglow_photometry.csv`);
  }

  onShowSourceLabelsChange($event: MatSlideToggleChange) {
    this.store.dispatch(new UpdateSourceCatalogConfig({ showSourceLabels: $event.checked }));
  }

  onAutoPhotometryChange($event: MatSlideToggleChange) {
    this.store.dispatch(new UpdateConfig({ autoPhot: $event.checked }));
  }

  onShowSourceMarkersChange($event: MatSlideToggleChange) {
    this.store.dispatch(new UpdateSourceCatalogConfig({ showSourceMarkers: $event.checked }));
  }

  onShowSourceAperturesChange($event: MatSlideToggleChange) {
    this.store.dispatch(new UpdateConfig({ showSourceApertures: $event.checked }));
  }

  trackById(index: number, row: { source: Source; data: PhotometryData }) {
    return row.source.id
  }

  getBatchInProgress(photJob: PhotometryJob, calJob: FieldCalibrationJob) {
    let states = ['in_progress', 'pending'];
    return states.includes(photJob.state?.status) || states.includes(calJob.state?.status)
  }
}
