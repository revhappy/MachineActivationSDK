import { applyPlaceholders } from '../src/scaffold';
import { assertEqual, test } from './_harness';

test('applyPlaceholders replaces known keys', () => {
  const out = applyPlaceholders('name: {{APP_NAME}}, pm: {{PACKAGE_MANAGER}}', {
    APP_NAME: 'my-app',
    PACKAGE_MANAGER: 'npm',
  });
  assertEqual(out, 'name: my-app, pm: npm');
});

test('applyPlaceholders leaves unknown placeholders untouched', () => {
  const out = applyPlaceholders('hello {{UNKNOWN}} there', {
    APP_NAME: 'x',
    PACKAGE_MANAGER: 'npm',
  });
  assertEqual(out, 'hello {{UNKNOWN}} there');
});

test('applyPlaceholders handles repeats', () => {
  const out = applyPlaceholders('{{APP_NAME}}/{{APP_NAME}}/{{APP_NAME}}', {
    APP_NAME: 'a',
    PACKAGE_MANAGER: 'npm',
  });
  assertEqual(out, 'a/a/a');
});
