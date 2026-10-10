"""Fit one stable band-pass biquad to the pinned noise-filter cascade.

Optional NumPy/SciPy tooling; the fit objective is not a perceptual acceptance
metric. Compare native renders with the existing lab scorer before selection.
Band-pass coefficients follow https://www.w3.org/TR/audio-eq-cookbook/ .
"""
import copy
import math
import struct


def fit_controls(controls):
    import numpy as np
    import scipy
    from scipy.optimize import least_squares
    result=copy.deepcopy(controls)
    rate=controls.get('sample_rate',44100)
    frequencies=700*np.expm1(np.linspace(np.log1p(40/700),np.log1p(rate*.499/700),384))
    z=np.exp(-2j*np.pi*frequencies/rate)
    rows=[]
    def coefficients(parameters):
        frequency,q,gain=np.exp(parameters)
        omega=2*math.pi*frequency/rate; alpha=math.sin(omega)/(2*q)
        return gain*alpha/(1+alpha),-2*math.cos(omega)/(1+alpha),(1-alpha)/(1+alpha)
    def response(values):
        b0,a1,a2=values
        return np.abs(b0*(1-z*z)/(1+a1*z+a2*z*z))
    def f32(value): return struct.unpack('<f',struct.pack('<f',value))[0]
    for index,pitch in enumerate(controls['pitch']):
        high,low=pitch['filters']
        target=np.ones_like(z)
        for sign,(b0,a1,a2) in ((-1,high),(1,low)):
            target*=b0*(1+sign*2*z+z*z)/(1+a1*z+a2*z*z)
        magnitude=np.abs(target)
        wanted=np.log1p(magnitude/.01)
        initial=[frequencies[np.argmax(magnitude)],1.,float(max(magnitude))]
        bounds=(np.log([20,.15,.01]),np.log([rate*.49,8,1.5]))
        fitted=least_squares(lambda p:np.log1p(response(coefficients(p))/.01)-wanted,
                             np.log(initial),bounds=bounds,ftol=1e-10,xtol=1e-10,gtol=1e-10,max_nfev=200)
        if not fitted.success: raise ValueError(f'Band-pass fit failed at pitch {index}: {fitted.message}')
        values=[f32(x) for x in coefficients(fitted.x)]
        # Match the native emitter's half-scale, negated feedback table.
        quantized=[-round(-x*.5*(1<<23))/(1<<22) for x in values[1:]]
        poles=np.roots([1,*quantized]); radius=float(max(abs(poles)))
        if radius>=1 or not all(math.isfinite(x) for x in values):
            raise ValueError(f'Unstable/nonfinite band-pass at pitch {index}')
        result['pitch'][index]['filters']=[values,[1.,0.,0.]]
        rows.append(dict(pitch=index,frequency=float(np.exp(fitted.x[0])),q=float(np.exp(fitted.x[1])),
                         gain=float(np.exp(fitted.x[2])),coefficients=values,quantized_pole_radius=radius,
                         objective_mean_square=float(np.mean(fitted.fun**2)),evaluations=fitted.nfev))
    result['noise_filter']='fitted-bandpass-v1'
    report=dict(model='fitted-bandpass-v1',sample_rate=rate,numpy=np.__version__,scipy=scipy.__version__,
                objective='Squared log1p(magnitude/0.01) error on 384 mel-spaced frequencies; not perceptual qualification',
                frequency_min=40,frequency_max=rate*.499,rows=rows)
    return result,report


def write_coefficients(controls,path):
    path.write_text(''.join(' '.join(format(x,'.17g') for x in row['filters'][0])+'\n' for row in controls['pitch']))
