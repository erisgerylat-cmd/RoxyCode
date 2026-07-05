import type { ConfigManager } from '../core/ConfigManager.js';
import { ProfileInitializer } from './ProfileInitializer.js';
import type { ProfileInitOptions, ProfileInitResult } from './types.js';

export interface ProfileOnboardingOptions extends ProfileInitOptions {
  configManager: ConfigManager;
}

export class ProfileOnboarding {
  async runOnboarding(options: ProfileOnboardingOptions): Promise<ProfileInitResult> {
    const { configManager, ...initOptions } = options;

    const initializer = new ProfileInitializer(configManager);
    return initializer.init(initOptions);
  }
}
