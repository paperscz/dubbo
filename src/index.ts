import * as net from 'net';
import WorkerFactory, { WorkerServiceFrameworker } from '@nelts/worker';
import ServiceCompiler from './compilers/service';
import { Registry, RegistryOptions, Provider, ProviderOptions, ProviderContext, PROVIDER_CONTEXT_STATUS, Consumer, ConsumerOptions } from 'dubbo.ts';

import rpc_interface from './decorators/interface';
import rpc_group from './decorators/group';
import rpc_method from './decorators/method';
import rpc_version from './decorators/version';
import rpc_delay from './decorators/deplay';
import rpc_retries from './decorators/retries';
import rpc_timeout from './decorators/timeout';

const rpc = {
  interface: rpc_interface,
  group: rpc_group,
  method: rpc_method,
  version: rpc_version,
  delay: rpc_delay,
  retries: rpc_retries,
  timeout: rpc_timeout,
}

export {
  rpc,
}

export default class Dubbo implements WorkerServiceFrameworker {
  private _app: WorkerFactory<Dubbo>;
  private _registry: Registry;
  private _provider: Provider;
  private _consumer: Consumer;
  private _rpc_result_callback: (req: any[], res: any) => any;
  public server: net.Server;
  constructor(app: WorkerFactory<Dubbo>) {
    this._app = app;
    if (this.app.socket) {
      process.on('message', (message: any, socket: net.Socket) => {
        switch (message) {
          case this.app.sticky: this.resumeConnection(socket); break;
        }
      });
    }
  }

  get app() {
    return this._app;
  }

  get registry() {
    return this._registry;
  }

  get provider() {
    return this._provider;
  }

  get rpc() {
    return this._consumer;
  }

  setRpcResultCallback(fn: (req: any[], res: any) => any) {
    this._rpc_result_callback = fn;
    return this;
  }

  private resumeConnection(socket: net.Socket) {
    if (!this.server) return socket.destroy();
    this.server.emit('connection', socket);
    socket.resume();
  }

  async componentWillCreate() {
    this.app.compiler.addCompiler(ServiceCompiler);
    const Provider_Options = this.app.configs.provider as ProviderOptions;
    const Consumer_Options = this.app.configs.consumer as ConsumerOptions;
    this._registry = new Registry(this.app.configs.registry as RegistryOptions);
    Provider_Options.port = this.app.port;
    Provider_Options.pid = process.pid;
    Provider_Options.registry = this._registry;
    Provider_Options.logger = this.app.logger;
    if (Consumer_Options) {
      Consumer_Options.pid = process.pid;
      Consumer_Options.registry = this._registry;
      this._consumer = new Consumer(Consumer_Options);
    }
    this._provider = new Provider(Provider_Options);
    this._provider.on('packet', async (ctx: ProviderContext) => {
      const target = ctx.interface.Constructor;
      const injector = this.app.injector.get<any>(target);
      if (!injector[ctx.method]) {
        ctx.status = PROVIDER_CONTEXT_STATUS.SERVICE_NOT_FOUND;
        ctx.body = `cannot find the method of ${ctx.method} on ${ctx.interface}:${ctx.interfaceVersion}@${ctx.group}#${ctx.dubboVersion}`;
      } else {
        let result = await Promise.resolve(injector[ctx.method](...ctx.parameters));
        if (this._rpc_result_callback) {
          const _result = this._rpc_result_callback(ctx.parameters, result);
          if (_result !== undefined) {
            result = _result;
          }
        }
        ctx.body = result;
      }
    })
  }

  async componentDidCreated() {
    await this._registry.connect();
    await new Promise((resolve, reject) => {
      this._provider.listen(this.app.port, (err: Error) => {
        if (err) return reject(err);
        resolve();
      })
    });
    this.app.logger.info('TCP SERVER STARTED.', 'pid:', process.pid, 'port:', this.app.port);
    await this.app.emit('ServerStarted');
  }

  async componentWillDestroy() {
    await new Promise(resolve => this._provider.close(resolve));
    this._consumer && await new Promise(resolve => this._consumer.close(resolve));
    await this.app.emit('ServerStopping');
  }

  async componentDidDestroyed() {
    this.registry.destory();
    await this.app.emit('ServerStopped');
  }
}