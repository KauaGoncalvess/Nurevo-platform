import { SetMetadata } from "@nestjs/common";

export const REQUIRED_MODULE = "entitlements:module";
export const REQUIRED_FEATURES = "entitlements:features";

/**
 * Obrigatório em TODO controller de módulo vertical (doc 02).
 *
 * "Um módulo desligado não expõe rota, não aparece no menu, não processa job."
 * Sem este decorator o módulo não é vendável — é só código que todo mundo usa
 * de graça.
 */
export const RequiresModule = (moduleKey: string): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_MODULE, moduleKey);

/** Feature booleana: `whatsapp.enabled`, `reports.advanced`. */
export const RequiresFeature = (
  ...featureKeys: string[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_FEATURES, featureKeys);
