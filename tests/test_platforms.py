# -*- coding: utf-8 -*-
"""Platform adapters are tested without accessing real credentials or external services."""
import io
import json
import runpy
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.module = runpy.run_path(str(ROOT / 'Урок-Zoom.py'))
        self.g = self.module['key_get'].__globals__

    @unittest.skipIf(sys.platform == 'darwin', 'macOS uses its built-in security command')
    def test_installed_native_backend_imports_without_accessing_secrets(self):
        backend = self.module['credential_backend']()
        expected = 'keyring.backends.Windows' if sys.platform == 'win32' else 'keyring.backends.SecretService'
        self.assertEqual(type(backend).__module__, expected)

    def test_native_macos_store_remains_compatible(self):
        self.g['sys'] = types.SimpleNamespace(platform='darwin')
        run = Mock(return_value=types.SimpleNamespace(returncode=0, stdout='existing-secret\n'))
        with patch.object(self.g['subprocess'], 'run', run):
            self.assertEqual(self.module['key_get']('Client Secret'), 'existing-secret')
            self.module['key_set']('Client Secret', 'new-secret')
        self.assertEqual(run.call_args_list[0].args[0][:4], ['security', 'find-generic-password', '-s', 'LessonZoom'])
        self.assertEqual(run.call_args_list[1].args[0][:3], ['security', 'add-generic-password', '-U'])

    def test_windows_and_linux_use_their_native_backends(self):
        for platform, module_name, class_name in [
            ('win32', 'keyring.backends.Windows', 'WinVaultKeyring'),
            ('linux', 'keyring.backends.SecretService', 'Keyring'),
        ]:
            with self.subTest(platform=platform):
                backend = Mock()
                backend.get_password.return_value = 'saved-key'
                factory = Mock(return_value=backend)
                fake = types.ModuleType(module_name)
                setattr(fake, class_name, factory)
                self.g['sys'] = types.SimpleNamespace(platform=platform)
                with patch.dict(sys.modules, {module_name: fake}):
                    self.assertEqual(self.module['key_get']('Client Secret'), 'saved-key')
                    self.module['key_set']('Client Secret', 'new-key')
                backend.get_password.assert_called_once_with('LessonZoom', 'Client Secret')
                backend.set_password.assert_called_once_with('LessonZoom', 'Client Secret', 'new-key')

    def test_locked_store_has_actionable_error_and_no_plaintext_fallback(self):
        self.g['sys'] = types.SimpleNamespace(platform='linux')
        backend = Mock()
        backend.get_password.side_effect = RuntimeError('locked')
        backend.set_password.side_effect = RuntimeError('locked')
        self.g['credential_backend'] = lambda: backend
        with self.assertRaisesRegex(ValueError, 'Secret Service'):
            self.module['key_get']('Client Secret')
        with self.assertRaisesRegex(ValueError, 'Разблокируйте'):
            self.module['key_set']('Client Secret', 'never-write-this-to-disk')
        result = self.module['config']()
        self.assertFalse(result['connected'])
        self.assertIn('Secret Service', result['storageError'])

    def test_missing_dependency_explains_installation(self):
        self.g['sys'] = types.SimpleNamespace(platform='win32')
        with patch.dict(sys.modules, {'keyring.backends.Windows': None}):
            with self.assertRaisesRegex(ValueError, 'requirements.txt'):
                self.module['key_get']('Client Secret')

    def test_state_is_utf8_and_preserves_non_ascii_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.g['STATE'] = Path(tmp) / 'state.json'
            state = {'students': [{'name': 'Юра 🐈'}]}
            self.module['save_state'](state)
            self.assertEqual(self.module['read_state'](), state)
            self.assertIn('Юра 🐈'.encode('utf-8'), self.g['STATE'].read_bytes())

    def test_html_is_read_as_utf8_and_served_only_to_local_host(self):
        handler_class = self.module['Handler']
        handler = object.__new__(handler_class)
        handler.headers = {'Host': '127.0.0.1:12345'}
        handler.server = types.SimpleNamespace(server_port=12345)
        handler.path = '/'
        handler.send = Mock()
        handler.do_GET()
        html = handler.send.call_args.args[0]
        self.assertIn('Новый урок', html)
        self.assertIn('window.TOKEN=', html)
        handler.headers = {'Host': 'other-site.test'}
        handler.send.reset_mock()
        handler.do_GET()
        self.assertEqual(handler.send.call_args.args[1], 403)


if __name__ == '__main__':
    unittest.main()
