import marketplaceTabTemplate from './marketplace-tab.html';
import { TemplateCache } from '../../utils/templateCache';

export function getMarketplaceTabHtml(): string {
    return TemplateCache.render(marketplaceTabTemplate, {});
}
