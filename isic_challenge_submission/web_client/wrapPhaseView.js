import { wrap } from 'girder/utilities/PluginUtils';

export default function (PhaseView) {
    function shouldWrap(view) {
        const meta = view.model.get('meta');
        const isicMeta = meta && meta.isic;
        return isicMeta && isicMeta.phaseType === 'validation';
    }

    wrap(PhaseView, 'render', function (render) {
        if (!shouldWrap(this)) {
            return render.call(this);
        }
        const hideScores = this.model.get('hideScores');
        this.model.set('hideScores', true);
        render.call(this);
        this.model.set('hideScores', hideScores);
        return this;
    });
}
