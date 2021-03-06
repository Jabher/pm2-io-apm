import { Feature } from './featureTypes'
import ProfilingCPUFallback from '../profiling/profilingCPUFallback'
import ProfilingHeapFallback from '../profiling/profilingHeapFallback'
import Configuration from '../configuration'
import * as semver from 'semver'

export default class ProfilingFeature implements Feature {

  private profilings

  init (forceFallback?: boolean) {
    // allow to force the fallback via environment
    if (process.env.PM2_PROFILING_FORCE_FALLBACK) forceFallback = true

    const isInspectorOk = (semver.satisfies(process.version, '>= 10.0.0') ||
      (semver.satisfies(process.version, '>= 8.0.0') && process.env.FORCE_INSPECTOR)) && !forceFallback
    let ProfilingCPU
    let ProfilingHeap

    if (isInspectorOk) {
      ProfilingCPU = require('../profiling/profilingCPU').default
      ProfilingHeap = require('../profiling/profilingHeap').default

      Configuration.configureModule({
        heapdump : true
      })
    }

    this.profilings = {
      cpuProfiling: isInspectorOk ? new ProfilingCPU() : new ProfilingCPUFallback(),
      heapProfiling: isInspectorOk ? new ProfilingHeap() : new ProfilingHeapFallback()
    }

    return this.profilings
  }

  destroy () {
    for (let profilingName in this.profilings) {
      if (typeof this.profilings[profilingName].destroy === 'function') {
        this.profilings[profilingName].destroy()
      }
    }
  }
}
