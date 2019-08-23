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

	/**
	 * it renders the inner block of the button component.
	 * It can be:
	 *  * _null_ if there are not defined blocks for the template (blank).
	 *  * _en empty array_ while it's still processing the template content.
	 *  * _an array of blocks_ once the template content has been parsed.
	 *
	 * @return {null|*} The inner content of the Item button.
	 */
	const renderInnerButton = () => {
		if ( null === blocks ) {
			return null;
		}

		if ( ! blocks.length ) {
			return <Spinner />;
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
