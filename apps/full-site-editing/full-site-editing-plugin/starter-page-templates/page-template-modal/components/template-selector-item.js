/**
 * External dependencies
 */

/**
 * WordPress dependencies
 */
import { Disabled, Spinner } from '@wordpress/components';

/**
 * Internal dependencies
 */
import BlockPreview from './block-template-preview';

const TemplateSelectorItem = props => {
	const {
		id,
		value,
		help,
		onFocus,
		onSelect,
		label,
		useDynamicPreview = false,
		staticPreviewImg,
		staticPreviewImgAlt = '',
		blocks = [],
	} = props;

	const renderInnerButton = () => {
		if ( ! blocks.length ) {
			return 'blank' !== value ? <Spinner /> : null;
		}

		if ( useDynamicPreview ) {
			return (
				<Disabled>
					<BlockPreview blocks={ blocks } viewportWidth={ 960 } />
				</Disabled>
			);
		}

		return (
			<img
				className="template-selector-item__media"
				src={ staticPreviewImg }
				alt={ staticPreviewImgAlt }
			/>
		);
	};

	return (
		<button
			type="button"
			id={ `${ id }-${ value }` }
			className="template-selector-item__label"
			value={ value }
			onMouseEnter={ () => onFocus( value, label ) }
			onClick={ () => onSelect( value, label ) }
			aria-describedby={ help ? `${ id }__help` : undefined }
		>
			<div className="template-selector-item__preview-wrap">{ renderInnerButton() }</div>
			{ label }
		</button>
	);
};

export default TemplateSelectorItem;
