export interface StackFormData {
    selectedLayerIds: string[];
    propagateMask: boolean;
    mode: 'average' | 'percentile' | 'mode' | 'sum';
    scaling: 'none' | 'average' | 'median' | 'mode';
    rejection: 'none' | 'chauvenet' | 'iraf' | 'minmax' | 'sigclip' | 'rcr';
    smartStacking: 'none' | 'SNR';
    percentile?: number;
    low?: number;
    high?: number;
    nuCol?: number;
    equalizeAdditive: boolean;
    equalizeOrder: number;
    equalizeMultiplicative: boolean;
    multiplicativePercentile: number;
    equalizeGlobal: boolean;
}
