import * as util from 'util'

import { Feature } from './featureTypes'
import * as semver from 'semver'
import JsonUtils from '../utils/json'
import Configuration from '../configuration'
import Transport from '../utils/transport'

import Debug from 'debug'
const debug = Debug('axm:notify')

export class NotifyOptions {
  level: string
  catchExceptions: boolean
}

export const NotifyOptionsDefault = {
  level: 'info',
  catchExceptions: true
}

export interface ErrorMetadata {
  type: String,
  subtype: String,
  className: String,
  description: String,
  objectId: String,
  uncaught: Boolean
}

export class NotifyFeature implements Feature {

  private options: NotifyOptions = NotifyOptionsDefault
  private levels: Array<string> = ['fatal', 'error', 'warn', 'info', 'debug', 'trace']
  private feature

  init (options?: NotifyOptions): Object {
    if (options) {
      this.options = options
    }

    if (this.options && this.options.catchExceptions) {
      if (process.env.CATCH_CONTEXT_ON_ERROR === 'true' && (semver.satisfies(process.version, '< 8.0.0') ||
          (semver.satisfies(process.version, '< 10.0.0') && !process.env.FORCE_INSPECTOR))) {
        debug(`Inspector is not available on node version ${process.version} !`)
      }

      if (process.env.CATCH_CONTEXT_ON_ERROR === 'true' && semver.satisfies(process.version, '>= 10.0.0') ||
        (semver.satisfies(process.version, '>= 8.0.0') && process.env.FORCE_INSPECTOR)) {
        debug('Enabling inspector based error reporting')
        const NotifyInspector = require('./notifyInspector').default
        this.feature = new NotifyInspector()
        this.feature.init(options)
      } else {
        this.catchAll()
      }
    }

    return {
      notifyError: this.notifyError
    }
  }

  destroy () {
    if (this.feature) {
      this.feature.destroy()
    }
  }

  notifyError (err: Error, level?: string) {

    if (!(err instanceof Error)) {
      console.trace('[PM2-IO-APM] You should use notify with an Error object')
      return -1
    }

    if (!level || this.levels.indexOf(level) === -1) {
      return Transport.send({
        type : 'process:exception',
        data : JsonUtils.jsonize(err)
      })
    }

    if (this.levels.indexOf(this.options.level) >= this.levels.indexOf(level)) {
      return Transport.send({
        type : 'process:exception',
        data : JsonUtils.jsonize(err)
      })
    }

    return null
  }

  catchAll (opts?: any): Boolean | void {

    if (opts === undefined) {
      opts = { errors: true }
    }

    Configuration.configureModule({
      error : opts.errors
    })

    if (process.env.exec_mode === 'cluster_mode') {
      return false
    }

    const self = this

    function getUncaughtExceptionListener (listener) {
      return function uncaughtListener (err) {
        let error = err && err.stack ? err.stack : err

        if (err && err.length) {
          err._length = err.length
          delete err.length
        }

        if (listener === 'unhandledRejection') {
          console.log('You have triggered an unhandledRejection, you may have forgotten to catch a Promise rejection:')
        }

        console.error(error)

        let errObj
        if (err) {
          errObj = self._interpretError(err)
        }

        Transport.send({
          type : 'process:exception',
          data : errObj !== undefined ? errObj : { message: 'No error but ' + listener + ' was caught!' }
        })

        if (!process.listeners(listener).filter(function (listener) {
          return listener !== uncaughtListener
        }).length) {

          if (listener === 'uncaughtException') {
            process.exit(1)
          }
        }
      }
    }

    if (opts.errors === true && util.inspect(process.listeners('uncaughtException')).length === 2) {
      process.once('uncaughtException', getUncaughtExceptionListener('uncaughtException'))
      process.once('unhandledRejection', getUncaughtExceptionListener('unhandledRejection'))
    } else if (opts.errors === false
      && util.inspect(process.listeners('uncaughtException')).length !== 2) {
      process.removeAllListeners('uncaughtException')
      process.removeAllListeners('unhandledRejection')
    }
  }

  expressErrorHandler () {
    Configuration.configureModule({
      error : true
    })

    return function errorHandler (err, req, res, next) {
      if (res.statusCode < 400) res.statusCode = 500

      err.url = req.url
      err.component = req.url
      err.action = req.method
      err.params = req.body
      err.session = req.session

      Transport.send({
        type  : 'process:exception',
        data  : JsonUtils.jsonize(err)
      })
      return next(err)
    }
  }

  private _interpretError (err: Error | string | object) {
    let sErr: any = {
      message: null,
      stack: null
    }

    if (err instanceof Error) {
      // Error object type processing
      sErr = err
    } else {
      // JSON processing
      sErr.message = err
      sErr.stack = err
    }

    return JsonUtils.jsonize(sErr)
  }
}
