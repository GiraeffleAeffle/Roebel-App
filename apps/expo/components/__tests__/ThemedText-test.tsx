import * as React from 'react';
import renderer from 'react-test-renderer';

import { ThemedText } from '../ThemedText';

it(`renders correctly`, async () => {
	let tree: renderer.ReactTestRenderer | undefined;

	await renderer.act(async () => {
		tree = renderer.create(<ThemedText>Snapshot test!</ThemedText>);
	});

	expect(tree?.toJSON()).toMatchSnapshot();

	await renderer.act(async () => {
		tree?.unmount();
	});
});
