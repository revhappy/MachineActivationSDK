import { Capacitor } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import {
  LITERT_LM_ANDROID_PRESET,
  pickActivationModelConfig,
  type ActivationModelFilePicker,
} from '@machine/activation-sdk';

const capacitorActivationModelFilePicker: ActivationModelFilePicker = {
  async pickModelFile() {
    const result = await FilePicker.pickFiles({ limit: 1 });
    const file = result.files[0];

    if (!file || !file.path) {
      return null;
    }

    return {
      name: file.name || file.path.split('/').pop() || 'model',
      path: file.path,
      sizeBytes: file.size,
      mimeType: file.mimeType,
    };
  },
};

export async function pickMachineActivationModel() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      'Local model picking is only available inside the native app build.',
    );
  }

  return pickActivationModelConfig(
    capacitorActivationModelFilePicker,
    LITERT_LM_ANDROID_PRESET,
  );
}
