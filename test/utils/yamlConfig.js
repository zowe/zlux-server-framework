/*
  This program and the accompanying materials are
  made available under the terms of the Eclipse Public License v2.0 which accompanies
  this distribution, and is available at https://www.eclipse.org/legal/epl-v20.html

  SPDX-License-Identifier: EPL-2.0

  Copyright Contributors to the Zowe Project.
*/

const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const yamlConfig = require('../../utils/yamlConfig');

describe('yamlConfig', function () {
  describe('getCurrentHaInstanceId', function () {
    afterEach(function () {
      delete process.env['ZWE_haInstance_id'];
    });

    it('should return ZWE_haInstance_id env var when set', function () {
      process.env['ZWE_haInstance_id'] = 'ha-instance-1';
      expect(yamlConfig.getCurrentHaInstanceId()).to.equal('ha-instance-1');
    });

    it('should return undefined when env var is not set', function () {
      delete process.env['ZWE_haInstance_id'];
      expect(yamlConfig.getCurrentHaInstanceId()).to.be.undefined;
    });
  });

  describe('getDefaultZoweDotYamlFile', function () {
    afterEach(function () {
      sinon.restore();
      delete process.env['ZWE_CLI_PARAMETER_CONFIG'];
    });

    it('should return undefined when ZWE_CLI_PARAMETER_CONFIG is not set', function () {
      delete process.env['ZWE_CLI_PARAMETER_CONFIG'];
      expect(yamlConfig.getDefaultZoweDotYamlFile()).to.be.undefined;
    });

    it('should return undefined when config file does not exist', function () {
      process.env['ZWE_CLI_PARAMETER_CONFIG'] = '/nonexistent/zowe.yaml';
      sinon.stub(fs, 'existsSync').returns(false);
      expect(yamlConfig.getDefaultZoweDotYamlFile()).to.be.undefined;
    });

    it('should return path when config file exists', function () {
      process.env['ZWE_CLI_PARAMETER_CONFIG'] = '/opt/zowe/zowe.yaml';
      sinon.stub(fs, 'existsSync').returns(true);
      expect(yamlConfig.getDefaultZoweDotYamlFile()).to.equal('/opt/zowe/zowe.yaml');
    });
  });

  describe('parseZoweDotYaml', function () {
    const fixturesDir = path.join(__dirname, '..', 'yaml-loader');

    it('should parse a simple yaml file', function () {
      const yamlFile = path.join(fixturesDir, 'yaml_simple.yaml');
      if (!fs.existsSync(yamlFile)) { this.skip(); }
      const config = yamlConfig.parseZoweDotYaml(yamlFile);
      expect(config).to.be.an('object');
    });

    it('should merge HA instance config when haInstanceId is provided', function () {
      const yamlContent = 'zowe:\n  workspaceDirectory: /tmp\nhaInstances:\n  inst1:\n    zowe:\n      port: 8544\ncomponents:\n  app-server:\n    node:\n      port: 80\n';
      const tmpFile = path.join(__dirname, '_test_ha.yaml');
      fs.writeFileSync(tmpFile, yamlContent);
      try {
        const config = yamlConfig.parseZoweDotYaml(tmpFile, 'inst1');
        expect(config.zowe).to.have.property('port');
        expect(config.zowe.port).to.equal(8544);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should resolve templates in config', function () {
      const yamlContent = 'zowe:\n  runtimeDirectory: /opt/zowe\n  workspaceDirectory: ${{ zowe.runtimeDirectory + "/workspace" }}\n';
      const tmpFile = path.join(__dirname, '_test_template.yaml');
      fs.writeFileSync(tmpFile, yamlContent);
      try {
        const config = yamlConfig.parseZoweDotYaml(tmpFile);
        expect(config.zowe.workspaceDirectory).to.equal('/opt/zowe/workspace');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should handle FILE() multi-config format', function () {
      const yaml1 = 'zowe:\n  runtimeDirectory: /opt/zowe\n';
      const yaml2 = 'zowe:\n  workspaceDirectory: /tmp/workspace\n';
      const tmpFile1 = path.join(__dirname, '_test_multi1.yaml');
      const tmpFile2 = path.join(__dirname, '_test_multi2.yaml');
      fs.writeFileSync(tmpFile1, yaml1);
      fs.writeFileSync(tmpFile2, yaml2);
      try {
        const configPaths = `FILE(${tmpFile1}):FILE(${tmpFile2})`;
        const config = yamlConfig.parseZoweDotYaml(configPaths);
        expect(config.zowe.runtimeDirectory).to.equal('/opt/zowe');
        expect(config.zowe.workspaceDirectory).to.equal('/tmp/workspace');
      } finally {
        fs.unlinkSync(tmpFile1);
        fs.unlinkSync(tmpFile2);
      }
    });

    it('should handle config without haInstances', function () {
      const yamlContent = 'zowe:\n  workspaceDirectory: /tmp\ncomponents:\n  app-server:\n    enabled: true\n';
      const tmpFile = path.join(__dirname, '_test_no_ha.yaml');
      fs.writeFileSync(tmpFile, yamlContent);
      try {
        const config = yamlConfig.parseZoweDotYaml(tmpFile, 'nonexistent');
        expect(config.zowe.workspaceDirectory).to.equal('/tmp');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should resolve nested templates up to 5 levels deep', function () {
      const yamlContent = [
        'zowe:',
        '  a: hello',
        '  b: ${{ zowe.a + " world" }}',
        '  c: ${{ zowe.b + "!" }}',
        ''
      ].join('\n');
      const tmpFile = path.join(__dirname, '_test_nested_tmpl.yaml');
      fs.writeFileSync(tmpFile, yamlContent);
      try {
        const config = yamlConfig.parseZoweDotYaml(tmpFile);
        expect(config.zowe.b).to.equal('hello world');
        expect(config.zowe.c).to.equal('hello world!');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should convert template result to number when applicable', function () {
      const yamlContent = 'zowe:\n  port: ${{ 8544 }}\n';
      const tmpFile = path.join(__dirname, '_test_num.yaml');
      fs.writeFileSync(tmpFile, yamlContent);
      try {
        const config = yamlConfig.parseZoweDotYaml(tmpFile);
        expect(config.zowe.port).to.equal(8544);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should convert template result to boolean', function () {
      const yamlContent = 'zowe:\n  enabled: ${{ "true" }}\n';
      const tmpFile = path.join(__dirname, '_test_bool.yaml');
      fs.writeFileSync(tmpFile, yamlContent);
      try {
        const config = yamlConfig.parseZoweDotYaml(tmpFile);
        expect(config.zowe.enabled).to.equal(true);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });
});
