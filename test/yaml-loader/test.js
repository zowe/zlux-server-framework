const yamlConfig = require('../../utils/yamlConfig');

const HA_ID = 'ha1';

console.log('\n---test simple');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./yaml_simple.yaml'), null, 2));

console.log('\n---test ha');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./yaml_with_ha.yaml', HA_ID), null, 2));

console.log('\n---test temp1');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./yaml_1_template.yaml'), null, 2));

console.log('\n---test temp2');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./yaml_2_template.yaml'), null, 2));

console.log('\n---test temp3');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./yaml_3_template.yaml'), null, 2));

console.log('\n---test array template');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./yaml_array_template.yaml'), null, 2));

console.log('\n---test temp partial');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./yaml_partial_template.yaml'), null, 2));

console.log('\n---test function');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./yaml_function.yaml'), null, 2));

console.log('\n---test temp and ha');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./yaml_templates_and_ha.yaml', HA_ID), null, 2));

console.log('\n--- appserver defaults');
console.log(JSON.stringify(yamlConfig.parseZoweDotYaml('./defaults.yaml', HA_ID), null, 2));

console.log(`\n---Eval leak test, components should be undefined:`);
try {
  console.log(components);
} catch (e) {
  console.log('coponents is undefined.')
}
console.log(`\n---Eval leak test, zowe should be undefined:`);
try {
  console.log(zowe);
} catch (e) {
  console.log('zowe is undefined');
}
