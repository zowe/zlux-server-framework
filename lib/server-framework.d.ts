declare namespace ZLUXServerFramework {

  const enum PluginType {
    Desktop = "desktop",
    Application = "application",
    Bootstrap = "bootstrap",
    NodeAuthentication = "nodeAuthentication",
    Library = "library"
  }

  const enum DataserviceType {
    Router = "router",
    Service = "service",
    Import = "import",
    External = "external",
    Node = "nodeService",
    Java = "java"
  }

  const enum Methods {
    GET = "GET",
    PUT = "PUT",
    POST = "POST",
    DELETE = "DELETE",
    OPTIONS = "OPTIONS",
    HEAD = "HEAD"
  }

  type DataserviceDefinition = {
    type: DataserviceType;
    version: string;
    name: string;
  }
  type RouterDataserviceDefinition = DataserviceDefinition & {
    routerFactory: string;

    filename?: string;
    fileName?: string;
    
    httpCaching?: boolean;
    internalOnly?: boolean;

    // deprecated
    initializerLookupMethod?: string;
    dependenciesIncluded?: string;
    
  }
  type NodeDataserviceDefinition = DataserviceDefinition & {
    fileName: string;
    methods: Methods[];
    handlerInstaller: string;

    // deprecated
    initializerLookupMethod?: string;
    dependenciesIncluded?: string;
    
  }
  type ServiceDataserviceDefinition = DataserviceDefinition & {
    methods: Methods[];
    initializerName: string;

    libraryName: string;
    libraryName31: string;
    libraryName64: string;

    initializerLookupMethod?: string;
    // deprecated
    dependenciesIncluded?: string;
    
  }
  type ImportDataserviceDefinition = DataserviceDefinition & {
    sourceName: string;
    localName: string;
    sourcePlugin: string;
    versionRange: string;    
  }
  type ExternalDataserviceDefinition = DataserviceDefinition & {
    urlPrefix?: string;
    host?: string;
    port?: number;
    isHttps?: boolean;
  }

  
  type ConfigurationDataDefinition = {
    type: any;
  }

  const enum IframeWebContentFramework {
    Iframe = "iframe"
  }
  
  const enum WebContentFramework {
    Angular2 = "angular2",
    Angular = "angular",
    React = "react",
    Iframe = "iframe"
  }


  const enum NativeWebContentFramework {
    Angular2 = "angular2",
    Angular = "angular",
    React = "react"
  }

  type NativeWebContentDefinition = {
    framework: NativeWebContentFramework;
    descriptionKey: string;
    descriptionDefault: string;
  }

  type IframeWebContentDefinition = {
    framework: IframeWebContentFramework;
    startingPage?: string;
    destination?: string;
  }  
  
  type PluginDefinition = {
    identifier: string;
    pluginType: PluginType;
    apiVersion: string;
    pluginVersion: string;
    license?: string;
    author?: string;
    homepage?: string;
    dataServices?: DataserviceDefinition[];
    configurationData?: ConfigurationDataDefinition;
    webContent?: IframeWebContentDefinition|NativeWebContentDefinition;
  }
  
  interface ComponentLogger {
    log(minimumLevel: number, ...loggableItems:any[]): void;
    info(...loggableItems:any[]): void;
    warn(...loggableItems:any[]): void;
    severe(...loggableItems:any[]): void;    
    debug(...loggableItems:any[]): void;
    makeSublogger(componentNameSuffix: string): ComponentLogger;
  }
  
  export interface Capabilities {
    canGetStatus: boolean,
    canRefresh: boolean,
    canAuthenticate: boolean,
    canAuthorize: boolean,
    canAddProxyAuthorization: boolean
  }

  export interface AuthenticateResult {
    success: boolean,
    username: string,
    expms: number
  }

  export interface AuthorizeResult {
    authenticated: boolean,
    authorized: boolean
  }

  export interface NodeAuthenticationInterface {
    authenticate(request: Object, sessionState: Object): Promise<AuthenticateResult>;
    getCapabilities(): Capabilities | Object;
    getStatus(sessionState: Object): Object;
    refreshStatus(request: Object, sessionState: Object): Promise<AuthenticateResult>;
    authorized(request: Object, sessionState: Object): AuthorizeResult;
  }

  export type StorageLocationType = 'ha' | 'cluster' | 'local';
  
  type Dict = { [key: string]: any };
  
  export interface PluginStorage {
    get(key: string, storageType?: StorageLocationType): Promise<any>;
    getAll(storageType?: StorageLocationType): Promise<Dict>;
    set(key: string, value: any, storageType?: StorageLocationType): Promise<void>;
    setAll(dict: Dict, storageType?: StorageLocationType): Promise<void>;
    delete(key: string, storageType?: StorageLocationType): Promise<void>;
    deleteAll(storageType?: StorageLocationType): Promise<void>;
  }
  
  export interface DataServiceContext {
    storage: PluginStorage;
    logger:  ComponentLogger;
    addBodyParseMiddleware: (router: any) => void;
  }
  
}
