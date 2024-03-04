const os = require('os');
let keyring_js;
let zcrypto;

interface KeyringInterface {
  getKey(user: string, ringName: string, label: string): any|undefined;
  getCA(user: string, ringName: string, label: string): any|undefined;
  getLabels(user: string, ringName: string, includeKeys: boolean): any|undefined;
}

export class KeyringJSKeyringHandler implements KeyringInterface {
  constructor(){
    if (os.platform() == 'os390') {
      if (!keyring_js) {
        keyring_js = require('keyring_js');
      }
    }
  }

  getKey(user: string, ringName: string, label: string): any|undefined {
    return keyring_js.getPemEncodedData(user, ringName, label);
  }

  getCA(user: string, ringName: string, label: string): any|undefined {
    return keyring_js.getPemEncodedData(user, ringName, label);
  }

  getLabels(user: string, ringName: string, includeKeys: boolean=false): any|undefined {
    return keyring_js.listKeyring(user, ringName);
  }
}

export class ZCryptoKeyringHandler implements KeyringInterface {
  private ringHandles: any = {};

  constructor(){
    if (os.platform() == 'os390') {
      if (!zcrypto) {
        zcrypto = require('@1000turquoisepogs/zcrypto');
      }
    }
  }

  private getOrCreateRingHandle(user: string, ringName: string): any {
    if (!this.ringHandles[user+'/'+ringName]) {
      let crypt = new zcrypto.ZCrypto();
      crypt.openKeyRing(user+'/'+ringName);
      this.ringHandles[user+'/'+ringName] = crypt;
    }
    return this.ringHandles[user+'/'+ringName];
  }

  getKey(user: string, ringName: string, label: string): any|undefined {
    let handle = this.getOrCreateRingHandle(user, ringName);
    if (handle) {
      let result = zcrypto.exportKeysToPKCS8(handle, label);
      if (result) {
        return { key: result.key, certificate: result.cert };
      }
    }
    return undefined;
  }

  getCA(user: string, ringName: string, label: string): any|undefined {
    let handle = this.getOrCreateRingHandle(user, ringName);
    if (handle) {
      return {certificate: zcrypto.exportCertToPEM(handle, label)};
    }
    return undefined;
  }

  getLabels(user: string, ringName: string, includeKeys: boolean=false): any|undefined {
    let handle = this.getOrCreateRingHandle(user, ringName);
    if (handle) {
      let result = handle.getRecordLabels(includeKeys);
      return result.map((name)=> { return {usage: 'CERTAUTH', label: name}});
    }
    return undefined;
  }
}
